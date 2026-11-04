import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { addContact, addProduct, addUser, newBusiness, paidSale, startApi, stopApi } from './support.js';

let runDueRules;

before(async () => {
  await startApi();
  ({ runDueRules } = await import('../src/services/recurring.js'));
});
after(stopApi);

const SETTINGS = {
  name: 'Toko Uji',
  address: 'Jl. Uji',
  taxpayer_type: 'individual',
  period_start_day: 1,
  tax_rate: 0.5,
  tax_threshold: 500_000_000,
};

async function saleWithCost(business, date) {
  const product = await addProduct(business, { cost_price: 1_200_000, sell_price: 2_000_000 });
  await paidSale(business, [{ product_id: product.id, qty: 1, unit_price: 2_000_000 }], {
    sale_date: date,
  });
}

function rent(business, amount, date) {
  return business.owner.post('/transactions', {
    type: 'expense',
    amount,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: date,
  });
}

test('AC-019: gross profit 800,000 and net profit 500,000; compare adds the previous range', async () => {
  const business = await newBusiness();
  await saleWithCost(business, '2026-10-10');
  await rent(business, 300_000, '2026-10-11');
  await saleWithCost(business, '2026-09-10');

  const pl = (await business.owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31')).body;
  assert.equal(pl.totals.revenue, 2_000_000);
  assert.equal(pl.totals.cogs, 1_200_000);
  assert.equal(pl.totals.gross_profit, 800_000);
  assert.equal(pl.totals.net_profit, 500_000);
  assert.equal(pl.is_empty, false);

  const compared = (
    await business.owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31&compare=true')
  ).body;
  const net = compared.rows.find((row) => row.label === 'Laba bersih');
  assert.deepEqual(compared.previous_range, { from: '2026-08-31', to: '2026-09-30' });
  assert.equal(net.previous, 800_000);
  assert.equal(net.change, -300_000);
});

test('BR-010: revenue counts on the sale date for credit sales; COGS uses the saved cost', async () => {
  const business = await newBusiness();
  const contact = await addContact(business);
  const product = await addProduct(business, { cost_price: 1_000, sell_price: 3_000 });
  await business.owner.post('/sales', {
    items: [{ product_id: product.id, qty: 2, unit_price: 3_000 }],
    payment_type: 'credit',
    contact_id: contact.id,
    sale_date: '2026-10-05',
    due_date: '2026-11-05',
  });
  await business.owner.put(`/products/${product.id}`, { cost_price: 9_999 });

  const pl = (await business.owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31')).body;
  assert.equal(pl.totals.revenue, 6_000);
  assert.equal(pl.totals.cogs, 2_000);
});

test('other income counts in profit; a sale income transaction does not count twice', async () => {
  const business = await newBusiness();
  await paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 5_000 }], { sale_date: '2026-10-05' });
  await business.owner.post('/transactions', {
    type: 'income',
    amount: 700,
    account_id: business.kas.id,
    category_id: business.category('Pendapatan Lain').id,
    occurred_on: '2026-10-06',
  });
  const pl = (await business.owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31')).body;
  assert.equal(pl.totals.revenue, 5_000);
  assert.equal(pl.totals.other_income, 700);
  assert.equal(pl.totals.net_profit, 5_700);
});

test('reports: sales by product reconciles with revenue; expense shares; aging buckets', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { name: 'Kopi', cost_price: 100, sell_price: 300 });
  await paidSale(business, [{ product_id: product.id, qty: 2, unit_price: 300 }], {
    sale_date: '2026-10-05',
    discount: 50,
  });
  await rent(business, 750, '2026-10-06');
  await business.owner.post('/transactions', {
    type: 'expense',
    amount: 250,
    account_id: business.kas.id,
    category_id: business.category('Gaji').id,
    occurred_on: '2026-10-06',
  });
  const range = 'from=2026-10-01&to=2026-10-31';

  const byProduct = (await business.owner.get(`/reports/sales-by-product?${range}`)).body;
  assert.equal(byProduct.totals.revenue, 550);
  assert.equal(byProduct.rows.find((r) => r.name === 'Kopi').margin, 400);
  assert.equal(byProduct.rows.find((r) => r.name === 'Diskon penjualan').revenue, -50);

  const byCategory = (await business.owner.get(`/reports/expense-by-category?${range}`)).body;
  assert.equal(byCategory.totals.amount, 1000);
  assert.equal(byCategory.rows.find((r) => r.name === 'Sewa').share, '75,0%');

  const contact = await addContact(business, { name: 'Bu Sari' });
  await business.owner.post('/debts', {
    type: 'receivable',
    contact_id: contact.id,
    amount: 900,
    issue_date: '2026-08-01',
    due_date: '2026-08-31',
  });
  const aging = (await business.owner.get('/reports/receivable-aging?from=2026-10-01&to=2026-10-20')).body;
  assert.equal(aging.totals.days_61_90, 900);
  assert.equal(aging.totals.remaining, 900);
});

test('reports validate the range and show empty state data; Staff get 403', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  const accountant = await addUser(business, 'accountant');

  const bad = await business.owner.get('/reports/profit-loss?from=2026-10-31&to=2026-10-01');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.fields.to, 'Tanggal akhir harus sama dengan atau setelah tanggal awal.');
  const tooLong = await business.owner.get('/reports/profit-loss?from=2015-01-01&to=2026-01-01');
  assert.equal(tooLong.status, 400);

  const empty = await business.owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31');
  assert.equal(empty.body.is_empty, true);

  for (const name of ['profit-loss', 'cash-flow', 'sales-by-product', 'expense-by-category', 'receivable-aging']) {
    const url = `/reports/${name}?from=2026-10-01&to=2026-10-31`;
    assert.equal((await staff.client.get(url)).status, 403, name);
    assert.equal((await accountant.client.get(url)).status, 200, name);
  }
  assert.equal((await staff.client.get('/reports/profit-loss/export?from=2026-10-01&to=2026-10-31&format=csv')).status, 403);
  assert.equal((await staff.client.get('/tax/estimate?year=2026')).status, 403);
  assert.equal((await staff.client.get('/budgets/summary')).status, 403);
  assert.equal((await staff.client.get('/recurring')).status, 403);
});

test('AC-020: an exported file holds the same totals as the screen in all three formats', async () => {
  const business = await newBusiness();
  await saleWithCost(business, '2026-10-10');
  await rent(business, 300_000, '2026-10-11');
  const query = 'from=2026-10-01&to=2026-10-31';
  const screen = (await business.owner.get(`/reports/profit-loss?${query}`)).body;

  const xlsx = await business.owner.get(`/reports/profit-loss/export?${query}&format=xlsx`);
  assert.equal(xlsx.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.body);
  const fileRows = {};
  workbook.worksheets[0].eachRow((row) => {
    fileRows[row.getCell(1).value] = row.getCell(2).value;
  });
  for (const row of screen.rows) assert.equal(fileRows[row.label], row.amount, row.label);
  assert.equal(fileRows['Laba bersih'], 500_000);

  const csv = await business.owner.get(`/reports/profit-loss/export?${query}&format=csv`);
  assert.ok(csv.body.toString('utf8').includes('Laba bersih,500000'));
  assert.equal(csv.body.subarray(0, 3).toString('hex'), 'efbbbf', 'UTF-8 byte order mark');

  const pdf = await business.owner.get(`/reports/profit-loss/export?${query}&format=pdf`);
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');

  for (const name of ['cash-flow', 'sales-by-product', 'expense-by-category', 'receivable-aging']) {
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const file = await business.owner.get(`/reports/${name}/export?${query}&format=${format}`);
      assert.equal(file.status, 200, `${name} ${format}`);
    }
  }
});

test('AC-004: with period start day 25 the dashboard period is the one containing today', async () => {
  const business = await newBusiness();
  await business.owner.put('/business', { ...SETTINGS, period_start_day: 25 });
  const { period, today } = (await business.owner.get('/dashboard')).body;
  assert.equal(period.from.slice(8), '25');
  assert.equal(period.to.slice(8), '24');
  assert.ok(period.from <= today && today <= period.to);
});

test('AC-018: the Staff dashboard has no profit, balance, or cost figure', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  const product = await addProduct(business);
  await staff.client.post('/sales', {
    items: [{ product_id: product.id, qty: 1, unit_price: 10_000 }],
    payment_type: 'paid',
    account_id: business.kas.id,
  });
  const { body } = await staff.client.get('/dashboard');
  assert.equal(body.cards.today_sales, 10_000);
  const text = JSON.stringify(body);
  for (const forbidden of ['profit', 'balance', 'cost', 'margin', 'expense_breakdown', 'receivables']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
});

test('the Owner dashboard carries every card and widget, and an empty flag for new businesses', async () => {
  const business = await newBusiness();
  assert.equal((await business.owner.get('/dashboard')).body.is_empty, true);
  const product = await addProduct(business, { name: 'Kopi', low_stock_threshold: 9 });
  await paidSale(business, [{ product_id: product.id, qty: 3, unit_price: 10_000 }]);
  const { body } = await business.owner.get('/dashboard');
  assert.equal(body.is_empty, false);
  assert.equal(body.cards.today_sales, 30_000);
  assert.equal(body.cards.period_revenue, 30_000);
  assert.equal(body.cards.estimated_net_profit, 12_000);
  assert.equal(body.cards.total_balance, 30_000);
  assert.equal(body.top_products[0].name, 'Kopi');
  assert.equal(body.low_stock[0].name, 'Kopi');
  assert.equal(body.latest.length, 1);
  assert.ok(body.series.length >= 28);

  const previous = (await business.owner.get('/dashboard?period=previous')).body;
  assert.equal(previous.cards.period_revenue, 0);
  assert.ok(previous.period.to < body.period.from);
});

test('AC-016: Rent shows 120% and over budget; inventory and excluded spending do not count', async () => {
  const business = await newBusiness();
  const today = (await business.owner.get('/dashboard')).body.today;
  const rentCategory = business.category('Sewa');
  const saved = await business.owner.put('/budgets', {
    period: today,
    items: [
      { category_id: rentCategory.id, amount: 1_000_000 },
      { category_id: business.category('Gaji').id, amount: 1_000 },
    ],
  });
  assert.equal(saved.status, 200);
  await rent(business, 1_200_000, today);
  await business.owner.post('/transactions', {
    type: 'expense',
    amount: 850,
    account_id: business.kas.id,
    category_id: business.category('Gaji').id,
    occurred_on: today,
  });

  const { items, totals } = (await business.owner.get('/budgets/summary')).body;
  const rentLine = items.find((item) => item.category_id === rentCategory.id);
  assert.equal(rentLine.percent, 120);
  assert.equal(rentLine.status, 'over');
  assert.equal(rentLine.remaining, -200_000);
  assert.equal(items.find((item) => item.category_name === 'Gaji').status, 'near');
  assert.equal(totals.used, 1_200_850);

  const again = await business.owner.put('/budgets', {
    period: today,
    items: [{ category_id: rentCategory.id, amount: 2_000_000 }],
  });
  assert.equal(again.body.items.length, 1, 'one budget per period, updated in place');
  assert.equal(again.body.items[0].percent, 60);

  const zero = await business.owner.put('/budgets', { period: today, items: [{ category_id: rentCategory.id, amount: 0 }] });
  assert.equal(zero.status, 400);
});

function newRule(business, overrides = {}) {
  return business.owner.post('/recurring', {
    type: 'expense',
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    amount: 100_000,
    note: 'sewa bulanan',
    frequency: 'monthly',
    start_on: '2026-01-31',
    ...overrides,
  });
}

const dates = (list) => list.items.map((t) => t.occurred_on).sort();

test('AC-017: a monthly rule on the 31st posts on the last day of February, once per date', async () => {
  const business = await newBusiness();
  const rule = await newRule(business);
  assert.equal(rule.body.next_run_on, '2026-01-31');

  await runDueRules('2026-01-30');
  assert.equal((await business.owner.get('/transactions')).body.total, 0);

  await runDueRules('2026-03-01');
  const posted = (await business.owner.get('/transactions')).body;
  assert.deepEqual(dates(posted), ['2026-01-31', '2026-02-28']);
  assert.equal(posted.items[0].source_type, 'recurring');

  await runDueRules('2026-03-01');
  assert.equal((await business.owner.get('/transactions')).body.total, 2, 'never twice per date');

  await runDueRules('2026-03-31');
  assert.deepEqual(dates((await business.owner.get('/transactions')).body), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
  ]);
});

test('a paused rule posts nothing; resuming skips the paused days', async () => {
  const business = await newBusiness();
  const { body: rule } = await newRule(business, { frequency: 'daily', start_on: '2024-01-01' });
  await business.owner.put(`/recurring/${rule.id}`, { is_active: false });
  await runDueRules('2024-01-10');
  assert.equal((await business.owner.get('/transactions')).body.total, 0);

  const resumed = await business.owner.put(`/recurring/${rule.id}`, { is_active: true });
  assert.ok(resumed.body.next_run_on > '2024-01-10');
  assert.equal((await business.owner.get('/transactions')).body.total, 0);
  await business.owner.put(`/recurring/${rule.id}`, { is_active: false });
});

test('a failing rule is recorded and does not stop other rules; it retries next run', async () => {
  const business = await newBusiness();
  const extra = await business.owner.post('/accounts', { name: 'Tutup', type: 'bank', opening_balance: 0 });
  const failing = await newRule(business, { account_id: extra.body.id, start_on: '2026-02-01' });
  await newRule(business, { start_on: '2026-02-01', amount: 5 });
  await business.owner.post(`/accounts/${extra.body.id}/archive`);

  const result = await runDueRules('2026-02-01');
  assert.ok(result.failed >= 1);
  const list = (await business.owner.get('/transactions')).body;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].amount, 5);

  const rule = (await business.owner.get('/recurring')).body.items.find((r) => r.id === failing.body.id);
  assert.equal(rule.next_run_on, '2026-02-01');
  assert.match(rule.last_run_error, /sudah diarsipkan/);
  const audit = (await business.owner.get('/audit-logs?action=recurring_failed')).body;
  assert.equal(audit.items.length, 1);
  assert.equal(audit.items[0].user_id, null);

  const now = await business.owner.post(`/recurring/${failing.body.id}/run`);
  assert.equal(now.status, 422);
  assert.equal(now.body.error.message, 'Akun pada aturan ini sudah diarsipkan. Ganti akunnya.');
  await business.owner.put(`/recurring/${failing.body.id}`, { is_active: false });
});

test('post now moves the rule forward; a rule ends after its end date', async () => {
  const business = await newBusiness();
  const { body: rule } = await newRule(business, {
    frequency: 'weekly',
    start_on: '2030-01-01',
    end_on: '2030-01-10',
  });
  const first = await business.owner.post(`/recurring/${rule.id}/run`);
  assert.equal(first.status, 200);
  assert.equal(first.body.next_run_on, '2030-01-08');
  assert.equal(first.body.is_active, true);
  const second = await business.owner.post(`/recurring/${rule.id}/run`);
  assert.equal(second.body.is_active, false);
  assert.equal((await business.owner.post(`/recurring/${rule.id}/run`)).status, 422);
});

test('AC-021: a company with Rp10,000,000 turnover in a month owes Rp50,000', async () => {
  const business = await newBusiness();
  const missing = await business.owner.get('/tax/estimate?year=2025');
  assert.equal(missing.status, 422);
  assert.equal(missing.body.error.message, 'Lengkapi jenis wajib pajak di Pengaturan.');

  await business.owner.put('/business', { ...SETTINGS, taxpayer_type: 'company', tax_threshold: 0 });
  await paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 10_000_000 }], { sale_date: '2025-03-15' });
  const { body } = await business.owner.get('/tax/estimate?year=2025');
  assert.equal(body.months[2].tax, 50_000);
  assert.equal(body.total_tax, 50_000);
  assert.equal(body.months.length, 12);
  assert.match(body.disclaimer, /perkiraan/i);
  assert.equal((await business.owner.get('/tax/estimate?year=2019')).status, 400);
});

test('AC-022: individual threshold over real records, excluding voided sales and debt payments', async () => {
  const business = await newBusiness();
  await business.owner.put('/business', SETTINGS);
  for (let month = 1; month <= 12; month += 1) {
    const sale_date = `2025-${String(month).padStart(2, '0')}-15`;
    await paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 60_000_000 }], { sale_date });
  }
  const voided = await paidSale(business, [{ description: 'Salah', qty: 1, unit_price: 999_000_000 }], { sale_date: '2025-01-20' });
  await business.owner.post(`/sales/${voided.body.sale.id}/void`);

  const { body } = await business.owner.get('/tax/estimate?year=2025');
  assert.equal(body.months[7].tax, 0);
  assert.equal(body.months[8].tax, 200_000);
  assert.equal(body.months[9].tax, 300_000);
  assert.equal(body.months[11].tax, 300_000);

  const recorded = await business.owner.post('/tax/record-payment', {
    year: 2025,
    month: 9,
    amount: 200_000,
    account_id: business.kas.id,
    paid_on: '2025-10-10',
  });
  assert.equal(recorded.status, 201);
  const taxRow = (await business.owner.get(`/transactions/${recorded.body.transaction_id}`)).body;
  assert.equal(taxRow.category_name, 'Pajak');
});

function csvFile(text, name = 'data.csv') {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/csv' }), name);
  return form;
}

function importForm(business, text, extra = {}) {
  const form = csvFile(text);
  form.append('mapping', JSON.stringify({ date: 0, amount: 1, note: 2 }));
  form.append('account_id', business.kas.id);
  form.append('default_category_id', business.category('Lainnya').id);
  form.append('default_income_category_id', business.category('Pendapatan Lain').id);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

test('import: headers first, then a row preview; valid rows are saved', async () => {
  const business = await newBusiness();
  const text = 'tanggal,nominal,catatan\n2026-01-05,-50000,listrik\n05/01/2026,75.000,jual\nsalah,10,x\n2026-01-06,10.5,y\n';

  const headers = await business.owner.postForm('/import/preview', csvFile(text));
  assert.equal(headers.status, 200);
  assert.deepEqual(headers.body.headers, ['tanggal', 'nominal', 'catatan']);
  assert.equal(headers.body.row_count, 4);

  const preview = await business.owner.postForm('/import/preview', importForm(business, text));
  assert.deepEqual(preview.body.counts, { valid: 2, invalid: 2, duplicate: 0 });
  assert.equal(preview.body.preview[0].type, 'expense');
  assert.equal(preview.body.preview[1].type, 'income');
  assert.equal(preview.body.preview[2].reason, 'Tanggal tidak dikenali.');
  assert.equal(preview.body.preview[3].reason, 'Nominal tidak valid.');
  assert.equal((await business.owner.get('/transactions')).body.total, 0, 'preview saves nothing');

  const commit = await business.owner.postForm('/import/commit', importForm(business, text));
  assert.equal(commit.status, 200);
  assert.deepEqual(commit.body.summary, { imported: 2, skipped: 0, failed: 2 });
  assert.equal(commit.body.message, '2 transaksi diimpor, 2 dilewati.');
  const saved = (await business.owner.get('/transactions')).body;
  assert.equal(saved.total, 2);
  assert.equal(saved.items[0].source_type, 'import');
});

test('AC-023 / BR-014: a row identical to an existing one is a duplicate and skipped by default', async () => {
  const business = await newBusiness();
  const text = 'tanggal,nominal,catatan\n2026-02-01,-1000,bensin\n2026-02-01,-1000,bensin\n2026-02-02,-1000,bensin\n';
  const first = await business.owner.postForm('/import/commit', importForm(business, text));
  assert.deepEqual(first.body.summary, { imported: 2, skipped: 1, failed: 0 });

  const preview = await business.owner.postForm('/import/preview', importForm(business, text));
  assert.equal(preview.body.counts.duplicate, 3);
  const second = await business.owner.postForm('/import/commit', importForm(business, text));
  assert.deepEqual(second.body.summary, { imported: 0, skipped: 3, failed: 0 });

  const included = await business.owner.postForm(
    '/import/commit',
    importForm(business, text, { include_duplicates: 'true' }),
  );
  assert.equal(included.body.summary.imported, 3);
  assert.equal((await business.owner.get('/transactions')).body.total, 5);
});

test('import limits: 5,001 rows, 5 MB, and unreadable files are refused with nothing saved', async () => {
  const business = await newBusiness();
  const rows = Array.from({ length: 5001 }, (_, i) => `2026-01-01,${i + 1},x`).join('\n');
  const tooMany = await business.owner.postForm('/import/preview', csvFile(`a,b,c\n${rows}\n`));
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error.message, 'File melebihi 5.000 baris.');

  const big = await business.owner.postForm('/import/preview', csvFile('x'.repeat(5 * 1024 * 1024 + 1)));
  assert.equal(big.status, 400);
  assert.equal(big.body.error.fields.file, 'File melebihi 5 MB.');

  const broken = new FormData();
  broken.append('file', new Blob([Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])]), 'rusak.xlsx');
  const unreadable = await business.owner.postForm('/import/preview', broken);
  assert.equal(unreadable.status, 400);
  assert.equal(unreadable.body.error.code, 'UNREADABLE_FILE');
  assert.equal((await business.owner.get('/transactions')).body.total, 0);
});

test('import reads XLSX, and only the Owner may import', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(['Tanggal', 'Nominal', 'Catatan']);
  sheet.addRow([new Date('2026-03-04T00:00:00Z'), -2500, 'parkir']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const form = new FormData();
  form.append('file', new Blob([buffer]), 'data.xlsx');
  form.append('mapping', JSON.stringify({ date: 0, amount: 1, note: 2 }));
  form.append('account_id', business.kas.id);
  form.append('default_category_id', business.category('Lainnya').id);
  const commit = await business.owner.postForm('/import/commit', form);
  assert.equal(commit.status, 200);
  assert.equal(commit.body.summary.imported, 1);
  const { items } = (await business.owner.get('/transactions')).body;
  assert.equal(items[0].occurred_on, '2026-03-04');
  assert.equal(items[0].amount, 2500);

  const denied = await staff.client.postForm('/import/preview', csvFile('a,b\n1,2\n'));
  assert.equal(denied.status, 403);
});

function readZip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength;
    files[name] = inflateRawSync(buffer.subarray(start, start + compressedSize)).toString('utf8');
    offset = start + compressedSize;
  }
  return files;
}

test('AC-024: the export ZIP has every entity as UTF-8 CSV with a header row, and is audited', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  const accountant = await addUser(business, 'accountant');
  await paidSale(business, [{ description: 'Jasa, kopi "enak"', qty: 1, unit_price: 100 }]);

  assert.equal((await staff.client.get('/export/data')).status, 403);
  assert.equal((await staff.client.get('/audit-logs')).status, 403);

  const response = await accountant.client.get('/export/data');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  const files = readZip(response.body);
  const expected = [
    'accounts', 'categories', 'contacts', 'debts', 'invoices', 'payments', 'products',
    'sale_items', 'sales', 'stock_movements', 'transactions',
  ];
  assert.deepEqual(Object.keys(files).sort(), expected.map((name) => `${name}.csv`));
  for (const content of Object.values(files)) {
    assert.ok(content.startsWith('﻿'));
    assert.ok(content.split('\r\n')[0].includes('id'));
  }
  assert.ok(files['sale_items.csv'].includes('"Jasa, kopi ""enak"""'));

  const audit = (await business.owner.get('/audit-logs?action=export')).body;
  assert.equal(audit.total, 1);
});

test('audit log filters and stays read-only', async () => {
  const business = await newBusiness();
  await paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 100 }]);
  const { items, total } = (await business.owner.get('/audit-logs?entity_type=sale&action=create')).body;
  assert.equal(total, 1);
  assert.equal(items[0].detail.total, 100);
  const empty = (await business.owner.get('/audit-logs?from=2000-01-01&to=2000-01-02')).body;
  assert.equal(empty.total, 0);
  assert.equal((await business.owner.del(`/audit-logs/${items[0].id}`)).status, 404);
});
