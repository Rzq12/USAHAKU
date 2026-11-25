import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  addProduct,
  insertLegacyContact,
  insertLegacyCreditSale,
  insertLegacyDebt,
  insertLegacyDebtPayment,
  newBusiness,
  paidSale,
  startApi,
  stopApi,
} from './support.js';

const { addDays, todayJakarta } = await import('../src/lib/dates.js');

before(startApi);
after(stopApi);

// Stock movements are dated when they are written, so the scenarios run on today's date.
const TODAY = todayJakarta();
const YEAR = Number(TODAY.slice(0, 4));
const YEAR_START = `${YEAR}-01-01`;

// The page sends 1 January of the chosen date's year as `from`; the sheet only reads `to`.
const balanceSheet = async (business, asOf = TODAY) =>
  (await business.owner.get(`/reports/balance-sheet?from=${asOf.slice(0, 4)}-01-01&to=${asOf}`))
    .body;

function rowAmount(report, label) {
  for (const section of report.sections) {
    const row = section.rows.find((item) => item.label === label);
    if (row) return row.amount;
  }
  return undefined;
}

async function cashLine(business, categoryName, type, amount, occurredOn = TODAY) {
  const response = await business.owner.post('/transactions', {
    type,
    amount,
    account_id: business.kas.id,
    category_id: business.category(categoryName).id,
    occurred_on: occurredOn,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.transaction;
}

async function restock(business, product, body) {
  const response = await business.owner.post(`/products/${product.id}/stock`, {
    kind: 'restock',
    ...body,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

/** Every kind of entry the app writes, with figures worked out by hand in the first test. */
async function cleanBusiness() {
  const business = await newBusiness();
  await business.owner.put(`/accounts/${business.kas.id}`, {
    name: 'Kas',
    type: 'cash',
    opening_balance: 1_000_000,
  });
  const product = await addProduct(business, { cost_price: 6_000, opening_stock: 10 });
  await paidSale(business, [{ product_id: product.id, qty: 2, unit_price: 10_000 }], {
    sale_date: TODAY,
  });
  await restock(business, product, { qty: 5, record_expense: true, account_id: business.kas.id });
  await cashLine(business, 'Sewa', 'expense', 100_000);
  await cashLine(business, 'Pembelian Peralatan', 'expense', 150_000);
  await cashLine(business, 'Modal Pemilik', 'income', 1_000_000);
  await cashLine(business, 'Pinjaman Diterima', 'income', 500_000);
  await cashLine(business, 'Angsuran Pinjaman', 'expense', 100_000);
  await cashLine(business, 'Prive Pemilik', 'expense', 50_000);

  const customer = await insertLegacyContact(business, { name: 'Bu Sari' });
  const { debtId } = await insertLegacyCreditSale(business, {
    contactId: customer,
    total: 90_000,
    saleDate: TODAY,
    dueDate: TODAY,
  });
  await insertLegacyDebtPayment(business, {
    debtId,
    amount: 40_000,
    accountId: business.kas.id,
    paidOn: TODAY,
  });
  const supplier = await insertLegacyContact(business, { name: 'Pak Budi', type: 'supplier' });
  await insertLegacyDebt(business, {
    type: 'payable',
    contactId: supplier,
    amount: 70_000,
    categoryId: business.category('Sewa').id,
    issueDate: TODAY,
  });
  return business;
}

test('a clean business balances with no adjustment, line by line', async () => {
  const business = await cleanBusiness();
  const report = await balanceSheet(business);

  assert.equal(report.title, 'Neraca');
  assert.ok(report.subtitle.startsWith('Per '));
  assert.deepEqual(
    report.sections.map((section) => section.title),
    ['Harta', 'Kewajiban', 'Modal'],
  );
  // Cash: 1.000.000 + 20.000 - 30.000 - 100.000 - 150.000 + 1.000.000 + 500.000
  //       - 100.000 - 50.000 + 40.000. Profit: 110.000 sales - 12.000 cost - 170.000 rent.
  assert.deepEqual(report.totals, {
    cash: 2_130_000,
    receivables: 50_000,
    inventory: 78_000,
    current_assets: 2_258_000,
    fixed_assets: 150_000,
    total_assets: 2_408_000,
    payables: 70_000,
    loans: 400_000,
    total_liabilities: 470_000,
    opening_equity: 1_060_000,
    paid_in_capital: 1_000_000,
    drawings: -50_000,
    retained_earnings: 0,
    current_year_profit: -72_000,
    adjustment: 0,
    total_equity: 1_938_000,
    total_liabilities_and_equity: 2_408_000,
  });
  assert.equal(rowAmount(report, 'Kas'), 2_130_000);
  assert.equal(rowAmount(report, 'Total Harta'), 2_408_000);
  assert.equal(rowAmount(report, 'Total Kewajiban dan Modal'), 2_408_000);
  assert.equal(rowAmount(report, 'Penyesuaian Saldo'), undefined, 'hidden when zero');
  assert.equal(report.is_empty, false);
});

test('cash matches the cash flow closing, and this year profit matches profit and loss', async () => {
  const business = await cleanBusiness();
  const report = await balanceSheet(business);
  const range = `from=${YEAR_START}&to=${TODAY}`;
  const flow = (await business.owner.get(`/reports/cash-flow?${range}`)).body;
  const pl = (await business.owner.get(`/reports/profit-loss?${range}`)).body;
  assert.equal(report.totals.cash, flow.totals.closing);
  assert.equal(report.totals.current_year_profit, pl.totals.net_profit);
});

test('a past date ignores everything recorded after it', async () => {
  const business = await cleanBusiness();
  const report = await balanceSheet(business, addDays(TODAY, -1));
  assert.equal(report.totals.cash, 1_000_000);
  assert.equal(report.totals.inventory, 0);
  assert.equal(report.totals.opening_equity, 1_000_000);
  assert.equal(report.totals.total_assets, 1_000_000);
  assert.equal(report.totals.adjustment, 0);
});

test('a backdated sale takes stock out on its sale date, so the sheet still balances', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { cost_price: 6_000, opening_stock: 10 });
  const saleDate = addDays(TODAY, -3);
  const sale = await paidSale(business, [{ product_id: product.id, qty: 2, unit_price: 10_000 }], {
    sale_date: saleDate,
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));

  for (const asOf of [saleDate, TODAY]) {
    const report = await balanceSheet(business, asOf);
    assert.equal(report.totals.adjustment, 0, asOf);
    assert.equal(report.totals.total_assets, report.totals.total_liabilities_and_equity, asOf);
  }
  assert.equal((await balanceSheet(business)).totals.inventory, 48_000);
});

test('a voided sale leaves no trace in cash, stock, or profit', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { cost_price: 6_000, opening_stock: 10 });
  const sale = await paidSale(business, [{ product_id: product.id, qty: 2, unit_price: 10_000 }]);
  const voided = await business.owner.post(`/sales/${sale.body.sale.id}/void`);
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  const report = await balanceSheet(business);
  assert.equal(report.totals.inventory, 60_000);
  assert.equal(report.totals.cash, 0);
  assert.equal(report.totals.current_year_profit, 0);
  assert.equal(report.totals.adjustment, 0);
});

test('last year profit moves into retained earnings on 1 January', async () => {
  const business = await newBusiness();
  const sale = await paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 300_000 }], {
    sale_date: `${YEAR - 1}-12-20`,
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));

  const yearEnd = await balanceSheet(business, `${YEAR - 1}-12-31`);
  assert.equal(yearEnd.totals.current_year_profit, 300_000);
  assert.equal(yearEnd.totals.retained_earnings, 0);

  const newYear = await balanceSheet(business, YEAR_START);
  assert.equal(newYear.totals.current_year_profit, 0);
  assert.equal(newYear.totals.retained_earnings, 300_000);
  assert.equal(newYear.totals.total_equity, yearEnd.totals.total_equity);
});

test('financing categories map to loans or capital by their name', async () => {
  const business = await newBusiness();
  for (const name of ['Pinjaman Koperasi', 'Setoran Investor']) {
    const created = await business.owner.post('/categories', {
      name,
      type: 'income',
      cash_activity: 'financing',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  const categories = (await business.owner.get('/categories')).body.items;
  for (const [name, amount] of [
    ['Pinjaman Koperasi', 400_000],
    ['Setoran Investor', 250_000],
  ]) {
    const response = await business.owner.post('/transactions', {
      type: 'income',
      amount,
      account_id: business.kas.id,
      category_id: categories.find((category) => category.name === name).id,
      occurred_on: TODAY,
    });
    assert.equal(response.status, 201);
  }
  const report = await balanceSheet(business);
  assert.equal(report.totals.loans, 400_000);
  assert.equal(report.totals.paid_in_capital, 250_000);
  assert.equal(report.totals.adjustment, 0);
});

test('equipment bought on an old payable bill becomes a fixed asset when the bill is issued', async () => {
  const business = await newBusiness();
  const supplier = await insertLegacyContact(business, { name: 'Toko Alat', type: 'supplier' });
  const debtId = await insertLegacyDebt(business, {
    type: 'payable',
    contactId: supplier,
    amount: 800_000,
    categoryId: business.category('Pembelian Peralatan').id,
    issueDate: TODAY,
  });
  const unpaid = await balanceSheet(business);
  assert.equal(unpaid.totals.fixed_assets, 800_000);
  assert.equal(unpaid.totals.payables, 800_000);
  assert.equal(unpaid.totals.adjustment, 0);

  await insertLegacyDebtPayment(business, {
    debtId,
    amount: 800_000,
    accountId: business.kas.id,
    paidOn: TODAY,
  });
  const paid = await balanceSheet(business);
  assert.equal(paid.totals.fixed_assets, 800_000);
  assert.equal(paid.totals.payables, 0);
  assert.equal(paid.totals.cash, -800_000);
  assert.equal(paid.totals.adjustment, 0);
});

/*
 * Each known source of mismatch shows up in Penyesuaian Saldo with its exact size,
 * so a gap is never hidden behind a balanced-looking total.
 */
test('an excluded transaction moves cash but not profit, so it shows as an adjustment', async () => {
  const business = await newBusiness();
  const expense = await cashLine(business, 'Sewa', 'expense', 500_000);
  const updated = await business.owner.put(`/transactions/${expense.id}`, {
    amount: 500_000,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: TODAY,
    tags: [],
    is_excluded: true,
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const report = await balanceSheet(business);
  assert.equal(report.totals.adjustment, -500_000);
  assert.equal(rowAmount(report, 'Penyesuaian Saldo'), -500_000);
  assert.ok(report.notes.some((note) => note.startsWith('Penyesuaian Saldo')));
  assert.equal(report.totals.total_assets, report.totals.total_liabilities_and_equity);
});

test('a product without stock tracking still costs its sales, which shows as an adjustment', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, {
    cost_price: 6_000,
    track_stock: false,
    opening_stock: 0,
  });
  await paidSale(business, [{ product_id: product.id, qty: 1, unit_price: 10_000 }]);
  const report = await balanceSheet(business);
  assert.equal(report.totals.current_year_profit, 4_000);
  assert.equal(report.totals.adjustment, 6_000);
});

test('a cost price change revalues bought stock, which shows as an adjustment', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { cost_price: 6_000, opening_stock: 0 });
  await restock(business, product, { qty: 10, record_expense: true, account_id: business.kas.id });
  assert.equal((await balanceSheet(business)).totals.adjustment, 0);

  await business.owner.put(`/products/${product.id}`, { cost_price: 7_000 });
  const report = await balanceSheet(business);
  assert.equal(report.totals.inventory, 70_000);
  assert.equal(report.totals.adjustment, 10_000);
});

test('a restock without an expense adds stock from nowhere, which shows as an adjustment', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { cost_price: 6_000, opening_stock: 0 });
  await restock(business, product, { qty: 3 });
  const report = await balanceSheet(business);
  assert.equal(report.totals.inventory, 18_000);
  assert.equal(report.totals.adjustment, 18_000);
});

test('an empty business is empty, and every format exports', async () => {
  const business = await newBusiness();
  assert.equal((await balanceSheet(business)).is_empty, true);

  const busy = await cleanBusiness();
  const range = `from=${YEAR_START}&to=${TODAY}`;
  for (const format of ['csv', 'xlsx', 'pdf']) {
    const file = await busy.owner.get(`/reports/balance-sheet/export?${range}&format=${format}`);
    assert.equal(file.status, 200, format);
    assert.ok(
      file.headers.get('content-disposition').includes(`balance-sheet_${TODAY}.${format}`),
      format,
    );
    if (format === 'pdf') assert.equal(file.body.subarray(0, 5).toString(), '%PDF-');
    if (format === 'csv') assert.ok(file.body.toString('utf8').includes('Total Harta,2408000'));
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.body);
      assert.equal(workbook.worksheets[0].name, 'Neraca');
      assert.equal(workbook.worksheets[0].getCell('A2').value, 'Neraca');
    }
  }
});
