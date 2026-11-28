import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, stopApi, newBusiness } from './support.js';

/*
 * Equipment bought after the opening date: paid from a cash account, kept in the register,
 * depreciated from its purchase month. Profit and loss sees only the depreciation; cash
 * flow sees the payment; the balance sheet carries cost less accumulated depreciation.
 */

before(startApi);
after(stopApi);

const rowsOf = (table) => table.rows ?? table.sections.flatMap((section) => section.rows);
const amountOf = (table, label) => rowsOf(table).find((row) => row.label === label)?.amount;

async function openedBusiness() {
  const business = await newBusiness();
  const { owner } = business;
  let response = await owner.put(`/accounts/${business.kas.id}`, {
    name: 'Kas',
    type: 'cash',
    opening_balance: 5_000_000,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  response = await owner.put('/business/opening', {
    opening_date: '2026-10-01',
    opening_capital: 5_000_000,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return business;
}

const clipper = (business, changes = {}) => ({
  kind: 'fixed',
  group_name: 'Peralatan',
  name: 'Mesin Cukur Baru',
  acquired_on: '2026-11-10',
  cost: 1_200_000,
  useful_life_months: 12,
  expense_category_id: business.category('Lainnya').id,
  paid_from_account_id: business.kas.id,
  purchase_category_id: business.category('Pembelian Peralatan').id,
  ...changes,
});

const get = async (business, path) => {
  const response = await business.owner.get(path);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
};
const november = (business, report) =>
  get(business, `/reports/${report}?from=2026-11-01&to=2026-11-30`);

test('a purchase pays from cash, depreciates monthly, and keeps the balance sheet closed', async () => {
  const business = await openedBusiness();
  const created = await business.owner.post('/assets', clipper(business));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.purchase_transaction_id);
  assert.equal(created.body.paid_from_account_name, 'Kas');
  assert.equal(created.body.monthly_share, 100_000);

  const pl = await november(business, 'profit-loss');
  assert.equal(pl.totals.operating_expenses, 100_000, 'only November depreciation, not the price');

  const balance = await november(business, 'balance-sheet');
  assert.equal(balance.totals.cash, 3_800_000);
  assert.equal(balance.totals.purchased_fixed_assets, 0, 'the register carries it, not investing');
  assert.equal(balance.totals.fixed_assets_cost, 1_200_000);
  assert.equal(balance.totals.accumulated_depreciation, -100_000);
  assert.equal(balance.totals.retained_earnings, 0, 'a purchase is not part of the opening');
  assert.equal(balance.totals.current_year_profit, -100_000);
  assert.equal(balance.totals.adjustment, 0);

  const cash = await november(business, 'cash-flow');
  assert.equal(Math.abs(amountOf(cash, 'Pembelian Peralatan')), 1_200_000);

  const october = await get(business, '/reports/profit-loss?from=2026-10-01&to=2026-10-31');
  assert.equal(october.totals.operating_expenses, 0, 'nothing before the purchase month');
});

test('the purchase follows the asset and is only changed from the register', async () => {
  const business = await openedBusiness();
  const { owner } = business;
  const created = await owner.post('/assets', clipper(business));
  const transactionId = created.body.purchase_transaction_id;
  const transaction = (await owner.get(`/transactions/${transactionId}`)).body;
  assert.equal(transaction.source_type, 'asset');
  assert.equal(transaction.amount, 1_200_000);

  const body = {
    amount: transaction.amount,
    account_id: transaction.account_id,
    category_id: transaction.category_id,
    occurred_on: transaction.occurred_on,
    note: 'Nota toko alat',
    tags: [],
  };
  let response = await owner.put(`/transactions/${transactionId}`, body);
  assert.equal(response.status, 200, 'the note can change');
  response = await owner.put(`/transactions/${transactionId}`, { ...body, amount: 1 });
  assert.equal(response.status, 422);
  response = await owner.del(`/transactions/${transactionId}`);
  assert.equal(response.status, 409);

  response = await owner.put(`/assets/${created.body.id}`, clipper(business, { cost: 2_400_000 }));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal((await owner.get(`/transactions/${transactionId}`)).body.amount, 2_400_000);
  assert.equal((await november(business, 'balance-sheet')).totals.cash, 2_600_000);

  response = await owner.del(`/assets/${created.body.id}`);
  assert.equal(response.status, 204);
  assert.equal((await owner.get(`/transactions/${transactionId}`)).status, 404);
  const balance = await november(business, 'balance-sheet');
  assert.equal(balance.totals.cash, 5_000_000);
  assert.equal(balance.totals.fixed_assets, 0);
});

test('payment rules follow the opening date', async () => {
  const business = await openedBusiness();
  const { owner } = business;
  let response = await owner.post('/assets', clipper(business, { paid_from_account_id: null }));
  assert.equal(response.status, 400);
  assert.ok(response.body.error.fields.paid_from_account_id, 'a purchase needs a payment');

  response = await owner.post('/assets', clipper(business, { acquired_on: '2026-09-01' }));
  assert.equal(response.status, 400);
  assert.ok(response.body.error.fields.paid_from_account_id, 'the opening position is unpaid');

  response = await owner.post('/assets', clipper(business, { purchase_category_id: null }));
  assert.equal(response.status, 400);
  assert.ok(response.body.error.fields.purchase_category_id);

  response = await owner.post(
    '/assets',
    clipper(business, { purchase_category_id: business.category('Pembelian Stok').id }),
  );
  assert.equal(response.status, 400, 'stock purchases are not equipment');

  const other = await newBusiness();
  response = await owner.post('/assets', clipper(business, { paid_from_account_id: other.kas.id }));
  assert.equal(response.status, 400, "another business's account");

  response = await owner.post('/assets', clipper(business));
  assert.equal(response.status, 201);
  response = await owner.put('/business/opening', {
    opening_date: '2026-12-01',
    opening_capital: 5_000_000,
  });
  assert.equal(response.status, 400, 'the purchase is a transaction before that date');
});
