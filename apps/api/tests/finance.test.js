import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import {
  addProduct,
  insertLegacyContact,
  insertLegacyCreditSale,
  newBusiness,
  paidSale,
  pool,
  startApi,
  stopApi,
} from './support.js';

before(async () => {
  await startApi();
});
after(stopApi);

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

test('BR-010: old credit sales keep counting on the sale date; COGS uses the saved cost', async () => {
  const business = await newBusiness();
  const contactId = await insertLegacyContact(business, { name: 'Bu Sari' });
  await insertLegacyCreditSale(business, {
    contactId,
    total: 6_000,
    lineCost: 2_000,
    saleDate: '2026-10-05',
    dueDate: '2026-11-05',
  });
  const product = await addProduct(business, { cost_price: 1_000, sell_price: 3_000 });
  await paidSale(business, [{ product_id: product.id, qty: 1, unit_price: 3_000 }], {
    sale_date: '2026-10-06',
  });
  await business.owner.put(`/products/${product.id}`, { cost_price: 9_999 });

  const pl = (await business.owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31')).body;
  assert.equal(pl.totals.revenue, 9_000);
  assert.equal(pl.totals.cogs, 3_000);
});

test('other income counts in profit; a sale income transaction does not count twice', async () => {
  const business = await newBusiness();
  await paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 5_000 }], {
    sale_date: '2026-10-05',
  });
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

test('reports: sales by product reconciles with revenue; expense shares', async () => {
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
});

test('reports validate the range and show empty state data', async () => {
  const business = await newBusiness();

  const bad = await business.owner.get('/reports/profit-loss?from=2026-10-31&to=2026-10-01');
  assert.equal(bad.status, 400);
  assert.equal(
    bad.body.error.fields.to,
    'Tanggal akhir harus sama dengan atau setelah tanggal awal.',
  );
  const tooLong = await business.owner.get('/reports/profit-loss?from=2015-01-01&to=2026-01-01');
  assert.equal(tooLong.status, 400);

  const empty = await business.owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31');
  assert.equal(empty.body.is_empty, true);

  for (const name of ['profit-loss', 'cash-flow', 'sales-by-product', 'expense-by-category']) {
    const url = `/reports/${name}?from=2026-10-01&to=2026-10-31`;
    assert.equal((await business.owner.get(url)).status, 200, name);
  }
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

  for (const name of ['cash-flow', 'sales-by-product', 'expense-by-category']) {
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const file = await business.owner.get(`/reports/${name}/export?${query}&format=${format}`);
      assert.equal(file.status, 200, `${name} ${format}`);
    }
  }
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
  await paidSale(business, [{ description: 'Jasa, kopi "enak"', qty: 1, unit_price: 100 }]);

  const response = await business.owner.get('/export/data');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  const files = readZip(response.body);
  const expected = [
    'accounts',
    'categories',
    'contacts',
    'debts',
    'invoices',
    'payments',
    'products',
    'sale_items',
    'sales',
    'stock_movements',
    'transactions',
  ];
  assert.deepEqual(
    Object.keys(files).sort(),
    expected.map((name) => `${name}.csv`),
  );
  for (const content of Object.values(files)) {
    assert.ok(content.startsWith('﻿'));
    assert.ok(content.split('\r\n')[0].includes('id'));
  }
  assert.ok(files['sale_items.csv'].includes('"Jasa, kopi ""enak"""'));

  const { rows: audit } = await pool.query(
    `SELECT a.id FROM audit_logs a JOIN users u ON u.id = a.user_id
     WHERE a.action = 'export' AND u.email = $1`,
    [business.email],
  );
  assert.equal(audit.length, 1);
});

test('removed finance routes answer 404', async () => {
  const { owner } = await newBusiness();
  for (const url of ['/budgets/summary', '/recurring', '/tax/estimate?year=2026', '/audit-logs']) {
    assert.equal((await owner.get(url)).status, 404, url);
  }
  assert.equal((await owner.post('/import/commit')).status, 404);
});

test('saving settings keeps stored NPWP and tax values', async () => {
  const business = await newBusiness();
  const { body: settings } = await business.owner.get('/business');
  await pool.query(
    `UPDATE businesses
     SET npwp = '012345678901234', taxpayer_type = 'company', tax_rate_bp = 75,
         tax_threshold = 123456, payment_info = 'BCA 123'
     WHERE id = $1`,
    [settings.id],
  );

  const saved = await business.owner.put('/business', {
    name: 'Toko Baru',
    address: 'Jl. Baru',
    phone: '0812',
    period_start_day: 5,
  });

  assert.equal(saved.status, 200);
  assert.equal(saved.body.name, 'Toko Baru');
  const invalid = await business.owner.put('/business', {
    name: 'Toko Baru',
    period_start_day: 31,
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    invalid.body.error.fields.period_start_day,
    'Tanggal awal periode harus antara 1 dan 28.',
  );
  const { rows } = await pool.query(
    `SELECT npwp, taxpayer_type, tax_rate_bp, tax_threshold, payment_info, period_start_day
     FROM businesses WHERE id = $1`,
    [settings.id],
  );
  assert.equal(rows[0].npwp, '012345678901234');
  assert.equal(rows[0].taxpayer_type, 'company');
  assert.equal(rows[0].tax_rate_bp, 75);
  assert.equal(Number(rows[0].tax_threshold), 123456);
  assert.equal(rows[0].payment_info, 'BCA 123');
  assert.equal(rows[0].period_start_day, 5);
});

const dayBefore = (date) => {
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
};

const todayOf = async (business) => (await business.owner.get('/dashboard')).body.today;

function expenseOn(business, amount, date) {
  return business.owner.post('/transactions', {
    type: 'expense',
    amount,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: date,
  });
}

test('today_profit: sales minus cost, plus other income, minus expenses', async () => {
  const business = await newBusiness();
  const today = await todayOf(business);
  const product = await addProduct(business, { sell_price: 10_000, cost_price: 6_000 });
  await paidSale(business, [{ product_id: product.id, qty: 2, unit_price: 10_000 }]);
  await business.owner.post('/transactions', {
    type: 'income',
    amount: 5_000,
    account_id: business.kas.id,
    category_id: business.category('Pendapatan Lain').id,
    occurred_on: today,
  });
  await expenseOn(business, 3_000, today);

  const { body } = await business.owner.get('/dashboard');
  assert.deepEqual(Object.keys(body).sort(), ['is_empty', 'today', 'today_profit']);
  assert.equal(body.today_profit, 10_000);
  assert.equal(body.is_empty, false);
});

test('today_profit ignores voided sales, deleted and excluded entries, stock purchases, and other days', async () => {
  const business = await newBusiness();
  const today = await todayOf(business);
  const product = await addProduct(business);

  const voided = await paidSale(business, [{ product_id: product.id, qty: 1, unit_price: 10_000 }]);
  await business.owner.post(`/sales/${voided.body.sale.id}/void`);

  const deleted = await expenseOn(business, 1_000, today);
  await business.owner.del(`/transactions/${deleted.body.transaction.id}`);

  const excluded = await expenseOn(business, 2_000, today);
  await pool.query('UPDATE transactions SET is_excluded = true WHERE id = $1', [
    excluded.body.transaction.id,
  ]);

  await business.owner.post(`/products/${product.id}/stock`, {
    kind: 'restock',
    qty: 5,
    record_expense: true,
    account_id: business.kas.id,
  });
  await expenseOn(business, 4_000, dayBefore(today));

  const { body } = await business.owner.get('/dashboard');
  assert.equal(body.today_profit, 0);
});

test('today_profit can be negative and a new business is empty', async () => {
  const business = await newBusiness();
  const empty = (await business.owner.get('/dashboard')).body;
  assert.equal(empty.today_profit, 0);
  assert.equal(empty.is_empty, true);

  await expenseOn(business, 5_000, empty.today);
  const { body } = await business.owner.get('/dashboard');
  assert.equal(body.today_profit, -5_000);
  assert.equal(body.is_empty, false);
});
