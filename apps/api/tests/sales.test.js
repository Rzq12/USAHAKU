import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  addProduct,
  insertLegacyContact,
  insertLegacyCreditSale,
  insertLegacyDebt,
  insertLegacyDebtPayment,
  insertLegacyInvoice,
  newBusiness,
  paidSale,
  pool,
  startApi,
  stopApi,
} from './support.js';

before(startApi);
after(stopApi);

const stockOf = async (business, id) =>
  (await business.owner.get(`/products/${id}`)).body.stock_qty;
const balanceOf = async (business, name) =>
  (await business.owner.get('/accounts')).body.items.find((a) => a.name === name).balance;

test('AC-010 / BR-004: a sale of 3 from stock 10 leaves 7 and writes a movement', async () => {
  const business = await newBusiness();
  const product = await addProduct(business);
  const sale = await paidSale(business, [{ product_id: product.id, qty: 3, unit_price: 10_000 }]);
  assert.equal(sale.status, 201);
  assert.equal(sale.body.sale.total, 30_000);
  assert.ok(sale.body.transaction_id);
  assert.equal(await stockOf(business, product.id), 7);
  assert.equal(await balanceOf(business, 'Kas'), 30_000);

  const { items } = (await business.owner.get(`/products/${product.id}/movements`)).body;
  assert.deepEqual(items.map((m) => [m.movement_type, m.qty]).sort(), [
    ['opening', 10],
    ['sale', -3],
  ]);
  assert.equal(sale.body.sale.items[0].unit_cost, 6_000);
});

test('AC-011 / BR-004: a sale above stock is rejected naming product and quantity', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { name: 'Kopi', unit: 'kg', opening_stock: 2 });
  const sale = await paidSale(business, [{ product_id: product.id, qty: 3, unit_price: 10_000 }]);
  assert.equal(sale.status, 422);
  assert.equal(sale.body.error.message, 'Stok Kopi hanya 2 kg.');
  assert.equal(await stockOf(business, product.id), 2);
  assert.equal((await business.owner.get('/sales')).body.total, 0);
});

test('BR-004: two lines of one product cannot together exceed stock; tracking off has no limit', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { opening_stock: 5 });
  const lines = [
    { product_id: product.id, qty: 3, unit_price: 100 },
    { product_id: product.id, qty: 3, unit_price: 100 },
  ];
  assert.equal((await paidSale(business, lines)).status, 422);

  const untracked = await addProduct(business, { track_stock: false, opening_stock: 0 });
  const sale = await paidSale(business, [{ product_id: untracked.id, qty: 999, unit_price: 100 }]);
  assert.equal(sale.status, 201);
  assert.equal(await stockOf(business, untracked.id), 0);
});

test('SRS-F-008: when a later step fails, no part of the sale is stored', async () => {
  const business = await newBusiness();
  const product = await addProduct(business);
  const scarce = await addProduct(business, { opening_stock: 1 });
  const response = await paidSale(business, [
    { product_id: product.id, qty: 4, unit_price: 10_000 },
    { description: 'Ongkos kirim', qty: 1, unit_price: 5_000 },
    { product_id: scarce.id, qty: 2, unit_price: 10_000 },
  ]);
  assert.equal(response.status, 422);
  assert.equal(await stockOf(business, product.id), 10);
  assert.equal(await balanceOf(business, 'Kas'), 0);
  assert.equal((await business.owner.get('/transactions')).body.total, 0);

  // A failure past the stock step: the audit entry cannot be written, so everything rolls back.
  await pool.query(
    `ALTER TABLE audit_logs ADD CONSTRAINT block_sale CHECK (entity_type <> 'sale') NOT VALID`,
  );
  try {
    const failed = await paidSale(business, [{ product_id: product.id, qty: 1, unit_price: 100 }]);
    assert.equal(failed.status, 500);
  } finally {
    await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT block_sale');
  }
  assert.equal(await stockOf(business, product.id), 10);
  assert.equal((await business.owner.get('/sales')).body.total, 0);
  assert.equal((await business.owner.get('/transactions')).body.total, 0);
});

test('discount cannot exceed the subtotal; free-text lines have no stock effect or cost', async () => {
  const business = await newBusiness();
  const tooMuch = await paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 100 }], {
    discount: 101,
  });
  assert.equal(tooMuch.status, 400);
  assert.ok(tooMuch.body.error.fields.discount);

  const sale = await paidSale(business, [{ description: 'Jasa', qty: 1.5, unit_price: 1_000 }], {
    discount: 500,
  });
  assert.equal(sale.body.sale.total, 1_000);
  assert.equal(sale.body.sale.items[0].unit_cost, 0);
});

test('BR-005: voiding a paid sale restores stock and reverses the income', async () => {
  const business = await newBusiness();
  const product = await addProduct(business);
  const sale = await paidSale(business, [{ product_id: product.id, qty: 3, unit_price: 10_000 }]);
  const voided = await business.owner.post(`/sales/${sale.body.sale.id}/void`);
  assert.equal(voided.status, 200);
  assert.equal(voided.body.status, 'void');
  assert.equal(await stockOf(business, product.id), 10);
  assert.equal(await balanceOf(business, 'Kas'), 0);
  assert.equal((await business.owner.get(`/sales/${sale.body.sale.id}/void`)).status, 404);
  assert.equal((await business.owner.post(`/sales/${sale.body.sale.id}/void`)).status, 409);

  const today = sale.body.sale.sale_date;
  const pl = (await business.owner.get(`/reports/profit-loss?from=${today}&to=${today}`)).body;
  assert.equal(pl.totals.revenue, 0);
});

test('BR-005: voiding an old credit sale voids the receivable, its payments, and its invoice', async () => {
  const business = await newBusiness();
  const contactId = await insertLegacyContact(business, { name: 'Bu Sari' });
  const { saleId, debtId } = await insertLegacyCreditSale(business, {
    contactId,
    total: 100_000,
    saleDate: '2026-10-01',
    dueDate: '2026-12-31',
  });
  const invoiceId = await insertLegacyInvoice(business, {
    saleId,
    number: 'INV/2026/0001',
    issueDate: '2026-10-01',
  });
  await insertLegacyDebtPayment(business, {
    debtId,
    amount: 40_000,
    accountId: business.kas.id,
    paidOn: '2026-10-02',
  });
  assert.equal(await balanceOf(business, 'Kas'), 40_000);

  const detail = (await business.owner.get(`/sales/${saleId}`)).body;
  assert.equal(detail.contact_name, 'Bu Sari');
  assert.equal(detail.debt_id, debtId);
  assert.equal(detail.payment_status, 'partial');
  assert.equal(detail.invoice_number, 'INV/2026/0001');

  const voided = await business.owner.post(`/sales/${saleId}/void`);
  assert.equal(voided.status, 200);
  assert.equal(voided.body.status, 'void');
  assert.equal(await balanceOf(business, 'Kas'), 0);
  const debt = (await pool.query('SELECT status, paid_amount FROM debts WHERE id = $1', [debtId]))
    .rows[0];
  assert.equal(debt.status, 'void');
  assert.equal(Number(debt.paid_amount), 0);
  const payment = await pool.query('SELECT is_void FROM debt_payments WHERE debt_id = $1', [
    debtId,
  ]);
  assert.equal(payment.rows[0].is_void, true);
  const invoice = await pool.query('SELECT status FROM invoices WHERE id = $1', [invoiceId]);
  assert.equal(invoice.rows[0].status, 'void');
});

test('low stock: the badge appears at the threshold and the sale warns', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { name: 'Gula', low_stock_threshold: 5 });
  assert.equal((await business.owner.get(`/products/${product.id}`)).body.low_stock, false);
  const sale = await paidSale(business, [{ product_id: product.id, qty: 5, unit_price: 100 }]);
  assert.deepEqual(sale.body.stock_warnings, ['Stok Gula tinggal 5 pcs.']);
  assert.equal((await business.owner.get(`/products/${product.id}`)).body.low_stock, true);
  assert.equal((await business.owner.get('/products?low_stock=true')).body.total, 1);
});

test('restock raises stock and can create an Inventory Purchase expense; adjustments need a reason', async () => {
  const business = await newBusiness();
  const product = await addProduct(business);
  const restock = await business.owner.post(`/products/${product.id}/stock`, {
    kind: 'restock',
    qty: 20,
    cost_price: 7_000,
    record_expense: true,
    account_id: business.kas.id,
  });
  assert.equal(restock.status, 200);
  assert.equal(restock.body.stock_qty, 30);
  assert.equal(restock.body.cost_price, 7_000);

  const { items } = (await business.owner.get('/transactions')).body;
  assert.equal(items[0].amount, 140_000);
  assert.equal(items[0].category_name, 'Pembelian Stok');
  assert.equal(items[0].source_type, 'restock');

  const today = items[0].occurred_on;
  const pl = (await business.owner.get(`/reports/profit-loss?from=${today}&to=${today}`)).body;
  assert.equal(pl.totals.operating_expenses, 0, 'BR-010: inventory purchases are not expenses');

  const noReason = await business.owner.post(`/products/${product.id}/stock`, {
    kind: 'adjustment',
    qty_delta: -1,
  });
  assert.equal(noReason.status, 400);
  const below = await business.owner.post(`/products/${product.id}/stock`, {
    kind: 'adjustment',
    qty_delta: -31,
    reason: 'rusak total',
  });
  assert.equal(below.status, 422);
  assert.equal(below.body.error.message, 'Stok tidak boleh kurang dari 0.');
  const adjust = await business.owner.post(`/products/${product.id}/stock`, {
    kind: 'adjustment',
    qty_delta: -1.5,
    reason: 'rusak kemasan',
  });
  assert.equal(adjust.body.stock_qty, 28.5);
});

test('duplicate product name or SKU returns a field error; inactive products leave the picker', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { name: 'Teh', sku: 'T-1' });
  const dupName = await business.owner.post('/products', {
    name: 'Teh',
    unit: 'pcs',
    sell_price: 1,
    cost_price: 1,
    track_stock: false,
  });
  assert.equal(dupName.body.error.fields.name, 'Nama produk sudah dipakai.');
  const dupSku = await business.owner.post('/products', {
    name: 'Teh 2',
    sku: 'T-1',
    unit: 'pcs',
    sell_price: 1,
    cost_price: 1,
    track_stock: false,
  });
  assert.equal(dupSku.body.error.fields.sku, 'SKU sudah dipakai.');

  await business.owner.put(`/products/${product.id}`, { is_active: false });
  assert.equal((await business.owner.get('/products')).body.total, 0);
  const sale = await paidSale(business, [{ product_id: product.id, qty: 1, unit_price: 1 }]);
  assert.equal(sale.status, 400);
});

test('AC-014 / BR-008: old debt payments move cash but add nothing to profit and loss', async () => {
  const business = await newBusiness();
  const contactId = await insertLegacyContact(business, { name: 'Pak Budi' });
  const receivable = await insertLegacyDebt(business, {
    type: 'receivable',
    contactId,
    amount: 1_000_000,
    issueDate: '2026-10-01',
  });
  const payable = await insertLegacyDebt(business, {
    type: 'payable',
    contactId,
    amount: 300_000,
    categoryId: business.category('Sewa').id,
    issueDate: '2026-10-01',
  });
  const pay = (debtId, amount) =>
    insertLegacyDebtPayment(business, {
      debtId,
      amount,
      accountId: business.kas.id,
      paidOn: '2026-10-10',
    });
  await pay(receivable, 400_000);
  await pay(payable, 300_000);
  assert.equal(await balanceOf(business, 'Kas'), 100_000);

  const range = 'from=2026-10-01&to=2026-10-31';
  const pl = (await business.owner.get(`/reports/profit-loss?${range}`)).body;
  assert.equal(pl.totals.revenue, 0);
  assert.equal(pl.totals.other_income, 0);
  assert.equal(pl.totals.operating_expenses, 300_000, 'BR-010: recognized once, on the issue date');

  const flow = (await business.owner.get(`/reports/cash-flow?${range}`)).body;
  assert.equal(flow.totals.money_in, 400_000);
  assert.equal(flow.totals.money_out, 300_000);
  assert.equal(flow.totals.closing, 100_000);
});

test('a sale is always paid: credit and contact fields are refused', async () => {
  const business = await newBusiness();
  const product = await addProduct(business);
  const items = [{ product_id: product.id, qty: 1, unit_price: 10_000 }];
  const base = { items, account_id: business.kas.id };

  const credit = await business.owner.post('/sales', { ...base, payment_type: 'credit' });
  assert.equal(credit.status, 400);
  const contactId = await insertLegacyContact(business, { name: 'Bu Sari' });
  const withContact = await business.owner.post('/sales', { ...base, contact_id: contactId });
  assert.equal(withContact.status, 400);
  const noAccount = await business.owner.post('/sales', { items });
  assert.equal(noAccount.status, 400);
  assert.equal(noAccount.body.error.fields.account_id, 'Pilih akun penerima.');
  assert.equal((await business.owner.get('/sales')).body.total, 0);

  const paid = await business.owner.post('/sales', base);
  assert.equal(paid.status, 201);
  assert.equal(paid.body.sale.payment_type, 'paid');
  assert.equal(paid.body.sale.contact_id, null);
});

test('removed commerce routes answer 404', async () => {
  const { owner } = await newBusiness();
  for (const url of ['/contacts', '/debts', '/invoices']) {
    assert.equal((await owner.get(url)).status, 404, url);
  }
  const aging = await owner.get('/reports/receivable-aging?from=2026-10-01&to=2026-10-31');
  assert.notEqual(aging.status, 200);
});

test('editing an old transaction keeps its contact', async () => {
  const business = await newBusiness();
  const contactId = await insertLegacyContact(business, { name: 'Pak Budi' });
  const created = await business.owner.post('/transactions', {
    type: 'expense',
    amount: 5_000,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: '2026-10-01',
  });
  const id = created.body.transaction.id;
  await pool.query('UPDATE transactions SET contact_id = $1 WHERE id = $2', [contactId, id]);

  const saved = await business.owner.put(`/transactions/${id}`, {
    amount: 5_000,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: '2026-10-01',
    contact_id: contactId,
    note: 'catatan baru',
    tags: [],
  });
  assert.equal(saved.status, 200);
  const { rows } = await pool.query('SELECT contact_id, note FROM transactions WHERE id = $1', [
    id,
  ]);
  assert.equal(rows[0].contact_id, contactId);
  assert.equal(rows[0].note, 'catatan baru');
});
