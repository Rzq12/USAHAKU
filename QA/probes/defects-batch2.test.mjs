/* global console, Buffer, FormData, Blob */
// QA reproduction probes. Run from the repo root: node --env-file=.env --test QA/probes/*.test.mjs
// They use apps/api/tests/support.js, which refuses any TEST_DATABASE_URL without 'test' and resets that database.
import { test, before, after } from 'node:test';

const support = await import('../../apps/api/tests/support.js');
const { startApi, stopApi, newBusiness, addProduct, paidSale, pool } = support;
const log = (k, v) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

before(startApi);
after(stopApi);

test('P17 another tenant reference blocks victim deleting own unused category', async () => {
  const a = await newBusiness();
  const victim = await newBusiness();
  const created = await victim.owner.post('/categories', {
    name: 'Kategori Baru Korban',
    type: 'expense',
    pl_group: 'operating_expense',
  });
  const victimCat = created.body;
  const p = await addProduct(a, { opening_stock: 0, cost_price: 1000 });
  await a.owner.post(`/products/${p.id}/stock`, {
    kind: 'restock',
    qty: 1,
    record_expense: true,
    account_id: a.kas.id,
  });
  const restock = (await a.owner.get('/transactions?type=expense')).body.items[0];
  const put = await a.owner.put(`/transactions/${restock.id}`, {
    amount: restock.amount,
    account_id: restock.account_id,
    occurred_on: restock.occurred_on,
    category_id: victimCat.id,
    transfer_account_id: null,
    contact_id: null,
    note: null,
    tags: [],
  });
  const del = await victim.owner.del(`/categories/${victimCat.id}`);
  const usage = (await victim.owner.get('/categories')).body.items.find(
    (c) => c.id === victimCat.id,
  )?.usage_count;
  log('P17_cross_tenant_delete_block', {
    attacker_put: put.status,
    victim_delete: del.status,
    victim_usage_count: usage,
    body: del.body,
  });
});

test('P18 expired session and logout behaviour', async () => {
  const b = await newBusiness();
  await pool.query(
    `UPDATE sessions SET expires_at = now() - interval '1 minute'
    WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [b.email],
  );
  const me = await b.owner.get('/auth/me');
  const out = await b.owner.post('/auth/logout');
  log('P18_expired_session', { me: me.status, logout: out.status });
});

test('P19 receipt uploads', async () => {
  const b = await newBusiness();
  const t = (
    await b.owner.post('/transactions', {
      type: 'expense',
      amount: 1000,
      account_id: b.kas.id,
      category_id: b.category('Sewa').id,
      occurred_on: today,
      tags: [],
    })
  ).body.transaction;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const send = async (bytes, name, type) => {
    const form = new FormData();
    form.append('receipt', new Blob([bytes], { type }), name);
    return b.owner.postForm(`/transactions/${t.id}/receipt`, form);
  };
  const big = Buffer.alloc(6 * 1024 * 1024, 0);
  png.copy(big);
  const r1 = await send(Buffer.from('<svg onload=alert(1)>'), 'x.png', 'image/png');
  const r2 = await send(big, 'big.png', 'image/png');
  const r3 = await send(png, 'ok.pdf', 'application/pdf');
  const wrongField = new FormData();
  wrongField.append('file', new Blob([png]), 'a.png');
  const r4 = await b.owner.postForm(`/transactions/${t.id}/receipt`, wrongField);
  const get = await b.owner.raw('GET', `/transactions/${t.id}/receipt`);
  log('P19_uploads', {
    svg_as_png: r1.status,
    six_mb: r2.status,
    six_mb_msg: r2.body.error?.message,
    png_named_pdf: r3.status,
    wrong_field: r4.status,
    served_type: get.headers.get('content-type'),
    nosniff: get.headers.get('x-content-type-options'),
  });
});

test('P20 year and month boundaries in profit and loss', async () => {
  const b = await newBusiness();
  const sale = (date, price) =>
    paidSale(b, [{ product_id: null, description: 'J', qty: 1, unit_price: price }], {
      sale_date: date,
    });
  await sale('2025-12-31', 1000);
  await sale('2026-01-01', 2000);
  await sale('2026-01-31', 4000);
  await sale('2026-02-01', 8000);
  const pl = async (f, t) =>
    (await b.owner.get(`/reports/profit-loss?from=${f}&to=${t}`)).body.totals.revenue;
  log('P20_boundaries', {
    dec2025: await pl('2025-12-01', '2025-12-31'),
    jan2026: await pl('2026-01-01', '2026-01-31'),
    feb2026: await pl('2026-02-01', '2026-02-28'),
    cross: await pl('2025-12-31', '2026-02-01'),
  });
  const far = await sale('1900-01-01', 5);
  const leap = await b.owner.get('/reports/profit-loss?from=2028-02-29&to=2028-02-29');
  log('P20b_far_past_and_leap', { sale_1900: far.status, leap_day_query: leap.status });
});

test('P21 duplicate submission creates two sales', async () => {
  const b = await newBusiness();
  const body = [{ product_id: null, description: 'Kopi', qty: 1, unit_price: 5000 }];
  const [r1, r2] = await Promise.all([paidSale(b, body), paidSale(b, body)]);
  const count = (await b.owner.get('/sales')).body.total;
  log('P21_duplicate', { statuses: [r1.status, r2.status], sales_count: count });
});

test('P22 product changes do not alter historical sale lines or COGS', async () => {
  const b = await newBusiness();
  const p = await addProduct(b, { sell_price: 10000, cost_price: 6000, opening_stock: 5 });
  const s = await paidSale(b, [{ product_id: p.id, qty: 2, unit_price: 10000 }]);
  await b.owner.put(`/products/${p.id}`, { cost_price: 9000, sell_price: 20000, is_active: false });
  const detail = (await b.owner.get(`/sales/${s.body.sale.id}`)).body;
  const pl = (await b.owner.get(`/reports/profit-loss?from=${today}&to=${today}`)).body.totals;
  const voided = await b.owner.post(`/sales/${s.body.sale.id}/void`);
  const prod = (await b.owner.get(`/products/${p.id}`)).body;
  log('P22_history', {
    line_cost: detail.items[0].line_cost,
    cogs: pl.cogs,
    void_inactive_product: voided.status,
    stock_after_void: prod.stock_qty,
  });
});

test('P23 legacy staff cannot log in, owner can', async () => {
  const b = await newBusiness();
  const staff = await support.insertLegacyUser(b, 'staff');
  await pool.query("UPDATE users SET is_active = false WHERE role <> 'owner'");
  const c = support.newClient();
  const r = await c.post('/auth/login', { email: staff.email, password: staff.password });
  const o = await support
    .newClient()
    .post('/auth/login', { email: b.email, password: 'kata-sandi-uji' });
  const rows = (await pool.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [staff.id]))
    .rows[0];
  log('P23_legacy_accounts', {
    staff_login: r.status,
    owner_login: o.status,
    staff_row_kept: rows.n === 1,
  });
});
