import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, stopApi, newBusiness, addProduct, paidSale } from './support.js';
import {
  accumulatedAmortization,
  amortizationBetween,
  monthlyShare,
  monthsRecognized,
} from '../src/lib/amortization.js';

/*
 * BARBERSHOP ANNO, October 2026, as kept in Zahir. Inputs are what Zahir was given: the
 * opening position on 1 October, the asset list, and October's cash transactions. The
 * expected figures are the ones printed on Zahir's Neraca, Laba Rugi, and Arus Kas.
 * Rent amortization, depreciation, and opening retained earnings are never entered: they
 * must come out of the calculation.
 */

before(startApi);
after(stopApi);

const OPENING_DATE = '2026-10-01';
const ACQUIRED_ON = '2026-07-01';
const EQUIPMENT = [
  { name: 'Kursi Barber (2 unit)', cost: 900_000, years: 5 },
  { name: 'Kursi Tunggu (1 unit)', cost: 400_000, years: 5 },
  { name: 'Mesin Cukur (2 unit)', cost: 600_000, years: 3 },
  { name: 'Gunting (2 unit)', cost: 230_000, years: 2 },
  { name: 'Kaca (2 unit)', cost: 300_000, years: 4 },
];

async function category(business, body) {
  const response = await business.owner.post('/categories', body);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function expense(business, categoryId, amount, occurredOn) {
  const response = await business.owner.post('/transactions', {
    type: 'expense',
    account_id: business.kas.id,
    category_id: categoryId,
    amount,
    occurred_on: occurredOn,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
}

async function barbershopAnno() {
  const business = await newBusiness();
  const { owner } = business;
  let response = await owner.put(`/accounts/${business.kas.id}`, {
    name: 'Kas',
    type: 'cash',
    opening_balance: 11_919_000,
  });
  assert.equal(response.status, 200);
  response = await owner.put('/business/opening', {
    opening_date: OPENING_DATE,
    opening_capital: 20_430_000,
    capital_name: 'Modal Bapak Candra',
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));

  const admin = await category(business, {
    name: 'Beban Administrasi Dan Umum',
    type: 'expense',
    pl_group: 'operating_expense',
  });
  const child = (name, parent, plGroup) =>
    category(business, { name, type: 'expense', parent_id: parent.id, pl_group: plGroup });
  const rent = await child('Beban Sewa', admin, 'operating_expense');
  const electricity = await child('Beban Listrik', admin, 'operating_expense');
  const cleaning = await child('Beban Kebersihan', admin, 'operating_expense');
  const salary = await child('Beban Gaji', admin, 'operating_expense');
  const depreciation = await category(business, {
    name: 'Beban Penyusutan',
    type: 'expense',
    pl_group: 'other_expense',
  });
  const equipmentDepreciation = await child(
    'Beban Penyusutan Peralatan',
    depreciation,
    'other_expense',
  );

  response = await owner.post('/assets', {
    kind: 'prepaid',
    group_name: 'Sewa Dibayar di Muka',
    name: 'Sewa tempat 1 tahun',
    acquired_on: ACQUIRED_ON,
    cost: 18_000_000,
    useful_life_months: 12,
    expense_category_id: rent.id,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  for (const item of EQUIPMENT) {
    response = await owner.post('/assets', {
      kind: 'fixed',
      group_name: 'Peralatan',
      name: item.name,
      acquired_on: ACQUIRED_ON,
      cost: item.cost,
      useful_life_months: item.years * 12,
      expense_category_id: equipmentDepreciation.id,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
  }

  const haircut = await addProduct(business, {
    name: 'Jasa Pangkas Rambut',
    unit: 'orang',
    sell_price: 20_000,
    cost_price: 0,
    track_stock: false,
    opening_stock: 0,
  });
  // 262 haircuts at Rp20.000 over October.
  for (const [saleDate, qty] of [
    ['2026-10-05', 60],
    ['2026-10-12', 50],
    ['2026-10-19', 52],
    ['2026-10-26', 50],
    ['2026-10-31', 50],
  ]) {
    response = await paidSale(business, [{ product_id: haircut.id, qty, unit_price: 20_000 }], {
      sale_date: saleDate,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
  }
  await expense(business, salary.id, 800_000, '2026-10-02');
  await expense(business, electricity.id, 53_000, '2026-10-07');
  await expense(business, electricity.id, 53_000, '2026-10-21');
  await expense(business, cleaning.id, 28_000, '2026-10-10');
  return business;
}

let anno;
const report = async (path) => {
  anno ??= await barbershopAnno();
  const response = await anno.owner.get(path);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
};
const rowsOf = (table) => table.rows ?? table.sections.flatMap((section) => section.rows);
const amountOf = (table, label) => rowsOf(table).find((row) => row.label === label)?.amount;

test('Laba Rugi October 2026 equals Zahir, amortization included', async () => {
  const pl = await report('/reports/profit-loss?from=2026-10-01&to=2026-10-31');
  assert.equal(pl.totals.revenue, 5_240_000);
  assert.equal(pl.totals.cogs, 0);
  assert.equal(pl.totals.gross_profit, 5_240_000);
  assert.equal(amountOf(pl, 'Beban Sewa'), 1_500_000);
  assert.equal(amountOf(pl, 'Beban Listrik'), 106_000);
  assert.equal(amountOf(pl, 'Beban Kebersihan'), 28_000);
  assert.equal(amountOf(pl, 'Beban Gaji'), 800_000);
  assert.equal(amountOf(pl, 'Total Beban Administrasi Dan Umum'), 2_434_000);
  assert.equal(pl.totals.operating_expenses, 2_434_000);
  assert.equal(pl.totals.operating_profit, 2_806_000);
  assert.equal(amountOf(pl, 'Beban Penyusutan Peralatan'), 54_167);
  assert.equal(pl.totals.other_expenses, 54_167);
  assert.equal(pl.totals.net_profit, 2_751_833);
});

test('Neraca 31 October 2026 equals Zahir, opening retained earnings derived', async () => {
  const balance = await report('/reports/balance-sheet?from=2026-10-01&to=2026-10-31');
  assert.equal(amountOf(balance, 'Kas'), 16_225_000);
  assert.equal(amountOf(balance, 'Sewa Dibayar di Muka'), 12_000_000);
  assert.equal(amountOf(balance, 'Peralatan'), 2_430_000);
  assert.equal(amountOf(balance, 'Akumulasi Penyusutan Peralatan'), -216_667);
  assert.equal(amountOf(balance, 'Total Harta'), 30_438_333);
  assert.equal(amountOf(balance, 'Total Kewajiban'), 0);
  assert.equal(amountOf(balance, 'Modal Bapak Candra'), 20_430_000);
  assert.equal(amountOf(balance, 'Laba Ditahan'), 7_256_500);
  assert.equal(amountOf(balance, 'Laba Tahun Berjalan'), 2_751_833);
  assert.equal(amountOf(balance, 'Total Modal'), 30_438_333);
  assert.equal(amountOf(balance, 'Total Kewajiban dan Modal'), 30_438_333);
  assert.equal(balance.totals.adjustment, 0);
  assert.equal(amountOf(balance, 'Penyesuaian Saldo'), undefined);
});

test('Arus Kas October 2026 equals Zahir: no amortization, only cash', async () => {
  const flow = await report('/reports/cash-flow?from=2026-10-01&to=2026-10-31');
  assert.equal(flow.totals.opening, 11_919_000);
  assert.equal(flow.totals.money_in, 5_240_000);
  assert.equal(flow.totals.money_out, 934_000);
  assert.equal(flow.totals.net_cash_flow, 4_306_000);
  assert.equal(flow.totals.closing, 16_225_000);
  const operating = flow.sections.find((s) => s.title === 'Arus kas dari aktivitas operasi');
  const labels = operating.rows.map((row) => row.label);
  assert.ok(!labels.includes('Beban Sewa'), 'rent amortization is not cash');
  assert.ok(!labels.includes('Beban Penyusutan Peralatan'), 'depreciation is not cash');
  assert.equal(amountOf(operating, 'Beban Gaji'), -800_000);
});

test('the asset register reports book values computed on the requested date', async () => {
  const list = await report('/assets?as_of=2026-10-31');
  const rent = list.items.find((item) => item.kind === 'prepaid');
  assert.equal(rent.accumulated, 6_000_000);
  assert.equal(rent.book_value, 12_000_000);
  assert.equal(rent.month_amortization, 1_500_000);
  const equipment = list.items.filter((item) => item.kind === 'fixed');
  assert.equal(
    equipment.reduce((sum, item) => sum + item.accumulated, 0),
    216_667,
  );
});

test('opening rules: assets precede the opening date, which precedes all transactions', async () => {
  const business = await newBusiness();
  const { owner } = business;
  await owner.post('/transactions', {
    type: 'expense',
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    amount: 10_000,
    occurred_on: '2026-03-05',
  });
  let response = await owner.put('/business/opening', {
    opening_date: '2026-04-01',
    opening_capital: 1_000_000,
  });
  assert.equal(response.status, 400);
  assert.ok(response.body.error.fields.opening_date);

  response = await owner.put('/business/opening', {
    opening_date: '2026-01-01',
    opening_capital: 1_000_000,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  response = await owner.post('/assets', {
    kind: 'fixed',
    group_name: 'Peralatan',
    name: 'Etalase',
    acquired_on: '2026-02-01',
    cost: 1_200_000,
    useful_life_months: 12,
    expense_category_id: business.category('Lainnya').id,
  });
  assert.equal(response.status, 400);
  assert.ok(response.body.error.fields.acquired_on);

  response = await owner.put('/business/opening', { opening_capital: 1_000_000 });
  assert.equal(response.status, 400, 'capital needs a date');
});

test('November keeps the fixed Rp54.167 share, and the balance sheet still closes', async () => {
  const pl = await report('/reports/profit-loss?from=2026-11-01&to=2026-11-30');
  assert.equal(amountOf(pl, 'Beban Penyusutan Peralatan'), 54_167);
  assert.equal(amountOf(pl, 'Beban Sewa'), 1_500_000);
  const balance = await report('/reports/balance-sheet?from=2026-11-01&to=2026-11-30');
  assert.equal(amountOf(balance, 'Akumulasi Penyusutan Peralatan'), -270_834);
  assert.equal(amountOf(balance, 'Sewa Dibayar di Muka'), 10_500_000);
  assert.equal(balance.totals.adjustment, 0);
});

const month = (index) => ({
  from: new Date(Date.UTC(2026, 6 + index, 1)).toISOString().slice(0, 10),
  to: new Date(Date.UTC(2026, 7 + index, 0)).toISOString().slice(0, 10),
});

test('Daftar-daftar rule: exact opening accumulation, then a fixed monthly share', () => {
  const chairs = { acquired_on: '2026-07-01', cost: 400_000, useful_life_months: 60 };
  const opening = '2026-10-01';
  assert.equal(monthsRecognized(chairs, '2026-06-30'), 0);
  assert.equal(monthsRecognized(chairs, '2026-07-30'), 0, 'July is recognized on 31 July');
  assert.equal(monthsRecognized(chairs, '2026-07-31'), 1);
  assert.equal(monthsRecognized(chairs, '2026-10-15'), 3);
  assert.equal(monthsRecognized(chairs, '2031-12-31'), 60, 'capped at the useful life');
  // Akumulasi 2 bulan 13.333, 3 bulan 20.000, Amortisasi /bulan 6.667.
  assert.equal(accumulatedAmortization(chairs, '2026-08-31', opening), 13_333);
  assert.equal(accumulatedAmortization(chairs, '2026-09-30', opening), 20_000);
  assert.equal(monthlyShare(chairs), 6_667);
  assert.equal(accumulatedAmortization(chairs, '2026-10-31', opening), 26_667);
  assert.equal(accumulatedAmortization(chairs, '2026-11-30', opening), 33_334);
  assert.equal(amortizationBetween(chairs, '2026-07-01', '2026-10-31', opening), 6_667);
  const shares = Array.from({ length: 60 }, (_, index) =>
    amortizationBetween(chairs, month(index).from, month(index).to, opening),
  );
  assert.deepEqual(shares.slice(0, 3), [0, 0, 0], 'before opening: inside the opening balance');
  assert.ok(shares.slice(3, 59).every((share) => share === 6_667));
  assert.equal(shares[59], 400_000 - 20_000 - 6_667 * 56, 'last month takes the rounding');
  assert.equal(20_000 + shares.reduce((sum, share) => sum + share, 0), 400_000);
});

test('without an opening date the fixed share runs from acquisition and ends at cost', () => {
  const scissors = { acquired_on: '2026-07-01', cost: 230_000, useful_life_months: 24 };
  const shares = Array.from({ length: 24 }, (_, index) =>
    amortizationBetween(scissors, month(index).from, month(index).to),
  );
  assert.ok(shares.slice(0, 23).every((share) => share === 9_583));
  assert.equal(
    shares.reduce((sum, share) => sum + share, 0),
    230_000,
  );
});
