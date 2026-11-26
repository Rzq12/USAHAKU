// QA edge-case probes. Run from the repo root: node --env-file=.env --test QA/probes/*.test.mjs
// They use apps/api/tests/support.js, which refuses any TEST_DATABASE_URL without 'test' and resets that database.
/* global console */
import { test, before, after } from 'node:test';

const support = await import('../../apps/api/tests/support.js');
const { startApi, stopApi, newBusiness, addProduct, paidSale } = support;
const log = (k, v) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

before(startApi);
after(stopApi);

test('E1 sale quantity, date, and account edge cases', async () => {
  const b = await newBusiness();
  const p = await addProduct(b, { opening_stock: 5 });
  const line = (qty) => [{ product_id: p.id, qty, unit_price: 10000 }];
  const zero = await paidSale(b, line(0));
  const negative = await paidSale(b, line(-1));
  const tooManyDecimals = await paidSale(b, line(1.0005));
  const badDate = await paidSale(b, line(1), { sale_date: '2026-13-01' });
  const farFuture = await paidSale(b, line(1), { sale_date: '2099-01-01' });
  await b.owner.post(`/accounts/${b.bank.id}/archive`, { is_archived: true });
  const archived = await paidSale(b, line(1), { account_id: b.bank.id });
  const noAccount = await paidSale(b, line(1), { account_id: null });
  const discount = await paidSale(b, line(1), { discount: 10001 });
  const zeroStock = await addProduct(b, { opening_stock: 0 });
  const empty = await paidSale(b, [{ product_id: zeroStock.id, qty: 1, unit_price: 1 }]);
  const stock = (await b.owner.get(`/products/${p.id}`)).body.stock_qty;
  log('E1_sale_edges', {
    zero: zero.status,
    negative: negative.status,
    tooManyDecimals: tooManyDecimals.status,
    badDate: badDate.status,
    farFuture: farFuture.status,
    archivedAccount: archived.status,
    noAccount: noAccount.status,
    discountOverSubtotal: discount.status,
    zeroStock: empty.status,
    stockUnchanged: stock === 5,
  });
});

test('E2 expense edge cases', async () => {
  const b = await newBusiness();
  const base = { type: 'expense', account_id: b.kas.id, occurred_on: today, tags: [] };
  const noCategory = await b.owner.post('/transactions', { ...base, amount: 1000 });
  const incomeCategory = await b.owner.post('/transactions', {
    ...base,
    amount: 1000,
    category_id: b.category('Pendapatan Lain').id,
  });
  const zero = await b.owner.post('/transactions', {
    ...base,
    amount: 0,
    category_id: b.category('Sewa').id,
  });
  const negative = await b.owner.post('/transactions', {
    ...base,
    amount: -5,
    category_id: b.category('Sewa').id,
  });
  const decimal = await b.owner.post('/transactions', {
    ...base,
    amount: 10.5,
    category_id: b.category('Sewa').id,
  });
  const badDate = await b.owner.post('/transactions', {
    ...base,
    amount: 1,
    occurred_on: '2026-02-30',
    category_id: b.category('Sewa').id,
  });
  const longNote = await b.owner.post('/transactions', {
    ...base,
    amount: 1,
    note: 'x'.repeat(501),
    category_id: b.category('Sewa').id,
  });
  const ok = await b.owner.post('/transactions', {
    ...base,
    amount: 12500,
    note: 'Beli gas 3 kg — Bu Siti, Rp12.500',
    category_id: b.category('Lainnya').id,
  });
  log('E2_expense_edges', {
    noCategory: noCategory.status,
    incomeCategory: incomeCategory.status,
    zero: zero.status,
    negative: negative.status,
    decimal: decimal.status,
    badDate: badDate.status,
    longNote: longNote.status,
    ok: ok.status,
    balance: ok.body.account_balance,
    note: ok.body.transaction?.note,
  });
});

test('E3 password and product edge cases', async () => {
  const b = await newBusiness();
  const wrong = await b.owner.post('/auth/change-password', {
    current_password: 'salah-sekali',
    new_password: 'sandi-baru-123',
  });
  const short = await b.owner.post('/auth/change-password', {
    current_password: 'kata-sandi-uji',
    new_password: 'pendek',
  });
  const p = await addProduct(b, { name: 'Gula', sku: 'GL-1' });
  const dupName = await b.owner.post('/products', {
    name: 'Gula',
    unit: 'kg',
    sell_price: 1,
    cost_price: 1,
    track_stock: false,
  });
  const dupSku = await b.owner.post('/products', {
    name: 'Gula Merah',
    sku: 'GL-1',
    unit: 'kg',
    sell_price: 1,
    cost_price: 1,
    track_stock: false,
  });
  const negAdj = await b.owner.post(`/products/${p.id}/stock`, {
    kind: 'adjustment',
    qty_delta: -999,
    reason: 'rusak',
  });
  const adj = await b.owner.post(`/products/${p.id}/stock`, {
    kind: 'adjustment',
    qty_delta: -2.5,
    reason: 'tumpah',
  });
  const untracked = await addProduct(b, { track_stock: false, opening_stock: 0 });
  const restockUntracked = await b.owner.post(`/products/${untracked.id}/stock`, {
    kind: 'restock',
    qty: 1,
  });
  log('E3_password_product', {
    wrongCurrent: wrong.status,
    shortNew: short.status,
    dupName: dupName.status,
    dupSku: dupSku.status,
    negativeStock: negAdj.status,
    adjustment: adj.status,
    stockAfter: adj.body.stock_qty,
    restockUntracked: restockUntracked.status,
  });
});

test('E4 cross-business IDs on main resources', async () => {
  const a = await newBusiness();
  const b = await newBusiness();
  const p = await addProduct(b);
  const s = await paidSale(b, [{ product_id: p.id, qty: 1, unit_price: 1 }]);
  const res = {
    product: (await a.owner.get(`/products/${p.id}`)).status,
    sale: (await a.owner.get(`/sales/${s.body.sale.id}`)).status,
    void: (await a.owner.post(`/sales/${s.body.sale.id}/void`)).status,
    tx: (await a.owner.get(`/transactions/${s.body.transaction_id}`)).status,
    account: (
      await a.owner.put(`/accounts/${b.kas.id}`, { name: 'X', type: 'cash', opening_balance: 0 })
    ).status,
    saleIntoOtherAccount: (
      await paidSale(a, [{ product_id: null, description: 'J', qty: 1, unit_price: 1 }], {
        account_id: b.kas.id,
      })
    ).status,
    saleOtherProduct: (await paidSale(a, [{ product_id: p.id, qty: 1, unit_price: 1 }])).status,
  };
  log('E4_idor_main_resources', res);
});
