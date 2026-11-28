import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { addProduct, newBusiness, paidSale, startApi, stopApi } from './support.js';

const { todayJakarta } = await import('../src/lib/dates.js');

before(startApi);
after(stopApi);

const TODAY = todayJakarta();
const YEAR_START = `${TODAY.slice(0, 4)}-01-01`;
const MONTH_START = `${TODAY.slice(0, 8)}01`;

async function businessWithActivity() {
  const business = await newBusiness();
  await business.owner.put(`/accounts/${business.kas.id}`, {
    name: 'Kas',
    type: 'cash',
    opening_balance: 1_000_000,
  });
  const product = await addProduct(business, { cost_price: 6_000, opening_stock: 10 });
  await paidSale(business, [{ product_id: product.id, qty: 2, unit_price: 10_000 }]);
  await business.owner.post('/transactions', {
    type: 'expense',
    amount: 5_000,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: TODAY,
  });
  return business;
}

const exportPackage = (business, query) =>
  business.owner.get(`/reports/financial-statements/export?${query}`);

/** Column B of the row whose column A is the label, read from one sheet. */
function sheetAmount(sheet, label) {
  let amount;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === label) amount = row.getCell(2).value;
  });
  return amount;
}

function sheetTexts(sheet) {
  const texts = [];
  sheet.eachRow((row) => texts.push(String(row.getCell(1).value ?? '')));
  return texts;
}

test('the Excel package holds the four statements, and they agree with each other', async () => {
  const business = await businessWithActivity();
  const file = await exportPackage(business, `from=${YEAR_START}&to=${TODAY}&format=xlsx`);
  assert.equal(file.status, 200);
  assert.ok(
    file.headers
      .get('content-disposition')
      .includes(`laporan-keuangan_${YEAR_START}_${TODAY}.xlsx`),
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.body);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ['Neraca', 'Laba Rugi', 'Perubahan Ekuitas', 'Arus Kas'],
  );
  const [balance, profit, equity, cash] = workbook.worksheets;
  assert.equal(balance.getCell('A1').value, 'Toko Uji');
  assert.equal(balance.getCell('A2').value, 'Neraca');
  assert.equal(profit.getCell('A2').value, 'Laporan Laba Rugi');
  assert.equal(equity.getCell('A2').value, 'Laporan Perubahan Ekuitas');
  assert.equal(cash.getCell('A2').value, 'Laporan Arus Kas');
  // Closing capital on the equity statement is total equity on the balance sheet.
  assert.equal(sheetAmount(equity, 'Modal Akhir'), sheetAmount(balance, 'Total Modal'));

  // Cash on the balance sheet equals the cash flow closing; this year profit equals net profit.
  assert.equal(sheetAmount(balance, 'Total Kas dan Bank'), 1_015_000);
  assert.equal(sheetAmount(cash, 'Saldo akhir kas dan bank'), 1_015_000);
  assert.equal(sheetAmount(balance, 'Laba Tahun Berjalan'), 3_000);
  assert.equal(sheetAmount(profit, 'Laba bersih'), 3_000);
  assert.ok(!sheetTexts(balance).some((text) => text.startsWith('Periode laporan ini')));
});

test('a range not starting on 1 January explains why the two profits differ', async () => {
  const business = await businessWithActivity();
  if (MONTH_START === YEAR_START) return;
  const file = await exportPackage(business, `from=${MONTH_START}&to=${TODAY}&format=xlsx`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.body);
  const note = sheetTexts(workbook.getWorksheet('Neraca')).find((text) =>
    text.startsWith('Periode laporan ini'),
  );
  assert.ok(note, 'balance sheet carries the note');
});

test('the PDF package starts each statement on its own page', async () => {
  const business = await businessWithActivity();
  const file = await exportPackage(business, `from=${YEAR_START}&to=${TODAY}&format=pdf`);
  assert.equal(file.status, 200);
  assert.equal(file.body.subarray(0, 5).toString(), '%PDF-');
  assert.ok(
    file.headers.get('content-disposition').includes(`laporan-keuangan_${YEAR_START}_${TODAY}.pdf`),
  );
  const pages = file.body.toString('latin1').match(/\/Type \/Page\b/g).length;
  assert.ok(pages >= 3, `expected a page per statement, got ${pages}`);
});

test('the package has no CSV, and a single report still exports as before', async () => {
  const business = await businessWithActivity();
  const csv = await exportPackage(business, `from=${YEAR_START}&to=${TODAY}&format=csv`);
  assert.equal(csv.status, 400);
  const single = await business.owner.get(
    `/reports/profit-loss/export?from=${YEAR_START}&to=${TODAY}&format=csv`,
  );
  assert.equal(single.status, 200);
});
