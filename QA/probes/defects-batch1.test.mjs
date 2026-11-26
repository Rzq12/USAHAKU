/* global console, performance */
// QA reproduction probes. Run from the repo root: node --env-file=.env --test QA/probes/*.test.mjs
// They use apps/api/tests/support.js, which refuses any TEST_DATABASE_URL without 'test' and resets that database.
import { test, before, after } from 'node:test';
import { randomUUID } from 'node:crypto';

const support = await import('../../apps/api/tests/support.js');
const { startApi, stopApi, newBusiness, addProduct, paidSale, insertLegacyContact, pool } = support;

const out = {};
const log = (key, value) => {
  out[key] = value;
  console.log(`PROBE ${key}: ${JSON.stringify(value)}`);
};

before(startApi);
after(async () => {
  await stopApi();
});

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

test('P1 manual transaction with unknown contact_id', async () => {
  const b = await newBusiness();
  const r = await b.owner.post('/transactions', {
    type: 'expense',
    amount: 1000,
    account_id: b.kas.id,
    category_id: b.category('Sewa').id,
    contact_id: randomUUID(),
    occurred_on: today,
    tags: [],
  });
  log('P1_unknown_contact_status', { status: r.status, body: r.body });
});

test('P2 system transaction category can be changed without validation', async () => {
  const b = await newBusiness();
  const p = await addProduct(b, { cost_price: 5000, opening_stock: 0 });
  await b.owner.post(`/products/${p.id}/stock`, {
    kind: 'restock',
    qty: 10,
    record_expense: true,
    account_id: b.kas.id,
  });
  const before = (await b.owner.get('/dashboard')).body;
  const list = (await b.owner.get('/transactions?type=expense')).body.items;
  const restock = list.find((t) => t.source_type === 'restock');
  const body = (category_id, note = restock.note) => ({
    amount: restock.amount,
    account_id: restock.account_id,
    occurred_on: restock.occurred_on,
    category_id,
    transfer_account_id: null,
    contact_id: null,
    note,
    tags: [],
  });
  const put = await b.owner.put(`/transactions/${restock.id}`, body(b.category('Sewa').id));
  const afterDash = (await b.owner.get('/dashboard')).body;
  const pl = (await b.owner.get(`/reports/profit-loss?from=${today}&to=${today}`)).body.totals;
  log('P2_restock_recategorized', {
    put: put.status,
    category: put.body.transaction?.category_name,
    profit_before: before.today_profit,
    profit_after: afterDash.today_profit,
    pl_net: pl.net_profit,
  });
  const put2 = await b.owner.put(
    `/transactions/${restock.id}`,
    body(b.category('Pendapatan Lain').id),
  );
  const dash2 = (await b.owner.get('/dashboard')).body;
  const pl2 = (await b.owner.get(`/reports/profit-loss?from=${today}&to=${today}`)).body.totals;
  log('P2b_expense_with_income_category', {
    put: put2.status,
    cat: put2.body.transaction?.category_name,
    dashboard: dash2.today_profit,
    pl_net: pl2.net_profit,
  });
  const put3 = await b.owner.put(`/transactions/${restock.id}`, body(null));
  log('P2c_null_category', { put: put3.status, body: put3.body });
  const put4 = await b.owner.put(`/transactions/${restock.id}`, body(randomUUID()));
  log('P2d_random_category', { put: put4.status, body: put4.body });
});

test('P3 cross-business category and contact references', async () => {
  const a = await newBusiness();
  const victim = await newBusiness();
  const victimCat = victim.category('Sewa');
  await victim.owner.put(`/categories/${victimCat.id}`, { name: 'Sewa Ruko Rahasia' });
  const victimContact = await insertLegacyContact(victim, { name: 'Pelanggan Rahasia B' });

  const p = await addProduct(a, { opening_stock: 5 });
  const sale = await paidSale(a, [{ product_id: p.id, qty: 1, unit_price: 10000 }]);
  const txId = sale.body.transaction_id;
  const tx = (await a.owner.get(`/transactions/${txId}`)).body;
  const put = await a.owner.put(`/transactions/${txId}`, {
    amount: tx.amount,
    account_id: tx.account_id,
    occurred_on: tx.occurred_on,
    category_id: victimCat.id,
    transfer_account_id: null,
    contact_id: victimContact,
    note: null,
    tags: [],
  });
  const got = (await a.owner.get(`/transactions/${txId}`)).body;
  const cf = (await a.owner.get(`/reports/cash-flow?from=${today}&to=${today}`)).body;
  const cfNames = cf.sections.flatMap((s) => s.rows.map((r) => r.label)).filter(Boolean);
  log('P3_cross_tenant_system_tx', {
    put: put.status,
    category_name: got.category_name,
    contact_name: got.contact_name,
    cash_flow_shows_victim_category: cfNames.includes('Sewa Ruko Rahasia'),
  });
  const manual = await a.owner.post('/transactions', {
    type: 'expense',
    amount: 1000,
    account_id: a.kas.id,
    category_id: a.category('Sewa').id,
    contact_id: victimContact,
    occurred_on: today,
    tags: [],
  });
  log('P3b_cross_tenant_contact_manual', {
    status: manual.status,
    contact_name: manual.body.transaction?.contact_name,
  });
});

test('P4 concurrent sales of the last unit', async () => {
  const b = await newBusiness();
  const p = await addProduct(b, { opening_stock: 1 });
  const results = await Promise.all(
    [1, 2, 3, 4].map(() => paidSale(b, [{ product_id: p.id, qty: 1, unit_price: 10000 }])),
  );
  const stock = (await b.owner.get(`/products/${p.id}`)).body.stock_qty;
  log('P4_concurrent_last_unit', { statuses: results.map((r) => r.status), stock });
});

test('P5 concurrent void of one sale', async () => {
  const b = await newBusiness();
  const p = await addProduct(b, { opening_stock: 5 });
  const sale = await paidSale(b, [{ product_id: p.id, qty: 2, unit_price: 10000 }]);
  const id = sale.body.sale.id;
  const results = await Promise.all([1, 2, 3].map(() => b.owner.post(`/sales/${id}/void`)));
  const stock = (await b.owner.get(`/products/${p.id}`)).body.stock_qty;
  const kas = (await b.owner.get('/accounts')).body.items.find((x) => x.name === 'Kas').balance;
  log('P5_concurrent_void', { statuses: results.map((r) => r.status), stock, kas });
});

test('P6 numeric overflow and malformed inputs', async () => {
  const b = await newBusiness();
  const r1 = await paidSale(b, [
    { product_id: null, description: 'Jasa', qty: 1e10, unit_price: 1 },
  ]);
  log('P6a_sale_qty_1e10', { status: r1.status, body: r1.body });
  const r2 = await b.owner.post('/products', {
    name: 'Besar',
    unit: 'pcs',
    sell_price: 1,
    cost_price: 1,
    track_stock: true,
    opening_stock: 1e10,
  });
  log('P6b_opening_stock_1e10', { status: r2.status, body: r2.body });
  const r3 = await paidSale(b, [
    { product_id: null, description: 'Mahal', qty: 999999, unit_price: 999999999999 },
  ]);
  log('P6c_line_total_overflow', { status: r3.status, body: r3.body });
  const r4 = await paidSale(
    b,
    Array.from({ length: 3 }, () => ({
      product_id: null,
      description: 'X',
      qty: 1,
      unit_price: 999999999999,
    })),
  );
  log('P6d_total_above_max_amount', { status: r4.status, total: r4.body.sale?.total });
  const r5 = await b.owner.post('/transactions', {
    type: 'expense',
    amount: '1000',
    account_id: b.kas.id,
    category_id: b.category('Sewa').id,
    occurred_on: today,
    tags: [],
  });
  log('P6e_amount_as_string', { status: r5.status });
  const r6 = await b.owner.raw('POST', '/transactions', {
    form: '{bad json',
    headers: { 'Content-Type': 'application/json' },
  });
  log('P6f_malformed_json', { status: r6.status, body: r6.body });
  const r7 = await b.owner.get('/sales/not-a-uuid');
  log('P6g_invalid_id', { status: r7.status });
  const r8 = await b.owner.get(`/reports/profit-loss?from=2026-02-30&to=${today}`);
  log('P6h_invalid_date', { status: r8.status });
  const r9 = await paidSale(b, [{ product_id: null, description: 'X', qty: 1, unit_price: 100 }], {
    payment_type: 'credit',
  });
  const r10 = await paidSale(b, [{ product_id: null, description: 'X', qty: 1, unit_price: 100 }], {
    contact_id: randomUUID(),
  });
  log('P6i_credit_and_contact', { credit: r9.status, contact: r10.status });
});

test('P7 archived account blocks editing old transactions', async () => {
  const b = await newBusiness();
  const created = await b.owner.post('/transactions', {
    type: 'expense',
    amount: 5000,
    account_id: b.bank.id,
    category_id: b.category('Sewa').id,
    occurred_on: today,
    tags: [],
  });
  const t = created.body.transaction;
  await b.owner.post(`/accounts/${b.bank.id}/archive`, { is_archived: true });
  const put = await b.owner.put(`/transactions/${t.id}`, {
    amount: t.amount,
    account_id: t.account_id,
    occurred_on: t.occurred_on,
    category_id: t.category_id,
    transfer_account_id: null,
    contact_id: null,
    note: 'catatan baru saja',
    tags: [],
  });
  log('P7_edit_note_on_archived_account', { status: put.status, body: put.body });
});

test('P8 archived account with balance leaves total balance', async () => {
  const b = await newBusiness();
  await b.owner.post('/transactions', {
    type: 'income',
    amount: 700000,
    account_id: b.bank.id,
    category_id: b.category('Pendapatan Lain').id,
    occurred_on: today,
    tags: [],
  });
  const before = (await b.owner.get('/accounts')).body.total_balance;
  await b.owner.post(`/accounts/${b.bank.id}/archive`, { is_archived: true });
  const afterArchive = (await b.owner.get('/accounts')).body.total_balance;
  const bs = (await b.owner.get(`/reports/balance-sheet?from=${today}&to=${today}`)).body.totals
    .cash;
  log('P8_archived_balance', { before, afterArchive, balance_sheet_cash: bs });
});

test('P9 login responses and headers', async () => {
  const b = await newBusiness();
  const c = support.newClient();
  const timings = { unknown: [], known: [] };
  for (let i = 0; i < 3; i += 1) {
    let t = performance.now();
    await c.post('/auth/login', {
      email: `nobody-${randomUUID().slice(0, 6)}@contoh.id`,
      password: 'salah-salah',
    });
    timings.unknown.push(Math.round(performance.now() - t));
    t = performance.now();
    await c.post('/auth/login', { email: b.email, password: `salah-${i}` });
    timings.known.push(Math.round(performance.now() - t));
  }
  log('P9_login_timing_ms', timings);
  const h = (await b.owner.get('/auth/me')).headers;
  log('P9_headers', {
    nosniff: h.get('x-content-type-options'),
    frame: h.get('x-frame-options'),
    csp: h.get('content-security-policy'),
    cache: h.get('cache-control'),
  });
  const b2 = await newBusiness();
  const same = await b2.owner.post('/auth/change-password', {
    current_password: 'kata-sandi-uji',
    new_password: 'kata-sandi-uji',
  });
  log('P9_change_to_same_password', { status: same.status });
});

test('P11 removed routes', async () => {
  const b = await newBusiness();
  const paths = [
    '/users',
    '/contacts',
    '/debts',
    '/invoices',
    '/budgets',
    '/recurring',
    '/tax',
    '/import',
    '/audit-logs',
    `/reports/receivable-aging?from=${today}&to=${today}`,
  ];
  const res = {};
  for (const p of paths) res[p] = (await b.owner.get(p)).status;
  const anon = support.newClient();
  res.anon_users = (await anon.get('/users')).status;
  res.anon_dashboard = (await anon.get('/dashboard')).status;
  log('P11_removed_routes', res);
});

test('P12 product rename rewrites historical sales-by-product label', async () => {
  const b = await newBusiness();
  const p = await addProduct(b, { name: 'Kopi Susu', opening_stock: 5 });
  await paidSale(b, [{ product_id: p.id, qty: 1, unit_price: 10000 }]);
  await b.owner.put(`/products/${p.id}`, { name: 'Es Teh' });
  const rep = (await b.owner.get(`/reports/sales-by-product?from=${today}&to=${today}`)).body;
  const sale = (await b.owner.get('/sales')).body.items[0];
  const detail = (await b.owner.get(`/sales/${sale.id}`)).body;
  log('P12_rename', {
    report_names: rep.rows.map((r) => r.name),
    sale_item_desc: detail.items[0].description,
  });
});

test('P13 data export entity list', async () => {
  const b = await newBusiness();
  await b.owner.post('/transactions', {
    type: 'expense',
    amount: 1000,
    account_id: b.kas.id,
    category_id: b.category('Sewa').id,
    occurred_on: today,
    tags: ['penting'],
    note: 'Bayar sewa kios — Bu Siti',
  });
  const r = await b.owner.get('/export/data');
  const names = [];
  const buf = r.body;
  for (let i = 0; i < buf.length - 4; i += 1) {
    if (buf.readUInt32LE(i) === 0x02014b50) {
      const len = buf.readUInt16LE(i + 28);
      names.push(buf.subarray(i + 46, i + 46 + len).toString('utf8'));
    }
  }
  log('P13_export_files', { status: r.status, names });
});

test('P14 expense on stock-purchase category neither reduces profit nor adds stock', async () => {
  const b = await newBusiness();
  const p = await addProduct(b, { opening_stock: 0, cost_price: 5000 });
  await b.owner.post('/transactions', {
    type: 'expense',
    amount: 50000,
    account_id: b.kas.id,
    category_id: b.category('Pembelian Stok').id,
    occurred_on: today,
    tags: [],
  });
  const dash = (await b.owner.get('/dashboard')).body;
  const prod = (await b.owner.get(`/products/${p.id}`)).body;
  const bs = (await b.owner.get(`/reports/balance-sheet?from=${today}&to=${today}`)).body.totals;
  log('P14_stock_purchase_via_expense', {
    profit: dash.today_profit,
    is_empty: dash.is_empty,
    stock: prod.stock_qty,
    adjustment: bs.adjustment,
    inventory: bs.inventory,
  });
});

test('P15 legacy credit sale void', async () => {
  const b = await newBusiness();
  const contact = await insertLegacyContact(b, { name: 'Pak Budi' });
  const { saleId, debtId } = await support.insertLegacyCreditSale(b, {
    contactId: contact,
    total: 300000,
    saleDate: '2026-06-10',
    dueDate: '2026-07-10',
    lineCost: 100000,
  });
  const payId = await support.insertLegacyDebtPayment(b, {
    debtId,
    amount: 100000,
    accountId: b.kas.id,
    paidOn: '2026-06-20',
  });
  const plBefore = (await b.owner.get('/reports/profit-loss?from=2026-06-01&to=2026-06-30')).body
    .totals;
  const kasBefore = (await b.owner.get('/accounts')).body.items.find(
    (a) => a.name === 'Kas',
  ).balance;
  const v = await b.owner.post(`/sales/${saleId}/void`);
  const plAfter = (await b.owner.get('/reports/profit-loss?from=2026-06-01&to=2026-06-30')).body
    .totals;
  const kasAfter = (await b.owner.get('/accounts')).body.items.find(
    (a) => a.name === 'Kas',
  ).balance;
  const debt = (await pool.query('SELECT status, paid_amount FROM debts WHERE id = $1', [debtId]))
    .rows[0];
  const pay = (await pool.query('SELECT is_void FROM debt_payments WHERE id = $1', [payId]))
    .rows[0];
  log('P15_legacy_void', {
    void: v.status,
    plBefore: plBefore.net_profit,
    plAfter: plAfter.net_profit,
    kasBefore,
    kasAfter,
    debt,
    pay,
  });
});

test('P16 manual profit check: independent expected value', async () => {
  const b = await newBusiness();
  const p1 = await addProduct(b, { sell_price: 15000, cost_price: 9000, opening_stock: 20 });
  const p2 = await addProduct(b, { sell_price: 2500, cost_price: 1200, opening_stock: 50 });
  // sale A: 3 x 15000 + 2.5 x 2500 = 45000 + 6250 = 51250, discount 1250 -> 50000; cogs 27000 + 3000 = 30000
  await paidSale(
    b,
    [
      { product_id: p1.id, qty: 3, unit_price: 15000 },
      { product_id: p2.id, qty: 2.5, unit_price: 2500 },
    ],
    { discount: 1250 },
  );
  // sale B: custom service 20000, cogs 0
  await paidSale(b, [{ product_id: null, description: 'Jasa antar', qty: 1, unit_price: 20000 }]);
  // voided sale C: must not count
  const c = await paidSale(b, [{ product_id: p1.id, qty: 1, unit_price: 15000 }]);
  await b.owner.post(`/sales/${c.body.sale.id}/void`);
  // other income 5000, capital 1000000 (financing, excluded), expense 12000, prive 300000 (financing)
  const post = (type, amount, cat) =>
    b.owner.post('/transactions', {
      type,
      amount,
      account_id: b.kas.id,
      category_id: b.category(cat).id,
      occurred_on: today,
      tags: [],
    });
  await post('income', 5000, 'Pendapatan Lain');
  await post('income', 1000000, 'Modal Pemilik');
  await post('expense', 12000, 'Listrik dan Utilitas');
  await post('expense', 300000, 'Prive Pemilik');
  // restock with expense: 10 x 9000 = 90000, inventory, not counted
  await b.owner.post(`/products/${p1.id}/stock`, {
    kind: 'restock',
    qty: 10,
    record_expense: true,
    account_id: b.kas.id,
  });
  // yesterday expense must not count on dashboard
  const y = new Date(Date.now() - 86400000);
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(y);
  await b.owner.post('/transactions', {
    type: 'expense',
    amount: 99999,
    account_id: b.kas.id,
    category_id: b.category('Sewa').id,
    occurred_on: yesterday,
    tags: [],
  });
  const expected = 50000 + 20000 - 30000 + 5000 - 12000; // 33000
  const dash = (await b.owner.get('/dashboard')).body;
  const pl = (await b.owner.get(`/reports/profit-loss?from=${today}&to=${today}`)).body.totals;
  // cash: +50000 +20000 +15000 -15000(void) +5000 +1000000 -12000 -300000 -90000 = 673000
  const kas = (await b.owner.get('/accounts')).body.items.find((x) => x.name === 'Kas').balance;
  const stock1 = (await b.owner.get(`/products/${p1.id}`)).body.stock_qty; // 20-3+10 = 27
  const stock2 = (await b.owner.get(`/products/${p2.id}`)).body.stock_qty; // 47.5
  log('P16_independent_calc', {
    expected_profit: expected,
    dashboard: dash.today_profit,
    pl_net: pl.net_profit,
    expected_kas: 573001,
    kas,
    expected_stock1: 27,
    stock1,
    expected_stock2: 47.5,
    stock2,
  });
});
