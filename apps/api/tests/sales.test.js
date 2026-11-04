import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  addContact,
  addProduct,
  addUser,
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

test('a credit sale creates a receivable and no income; credit needs a customer', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { opening_stock: 100 });
  const contact = await addContact(business, { type: 'customer' });
  const noCustomer = await business.owner.post('/sales', {
    items: [{ product_id: product.id, qty: 1, unit_price: 500_000 }],
    payment_type: 'credit',
    due_date: '2030-01-01',
  });
  assert.equal(noCustomer.status, 400);
  assert.equal(noCustomer.body.error.fields.contact_id, 'Pilih pelanggan untuk penjualan kredit.');

  const sale = await business.owner.post('/sales', {
    items: [{ product_id: product.id, qty: 1, unit_price: 500_000 }],
    payment_type: 'credit',
    contact_id: contact.id,
    sale_date: '2026-10-01',
    due_date: '2026-10-31',
  });
  assert.equal(sale.status, 201);
  assert.ok(sale.body.debt_id);
  const debt = (await business.owner.get(`/debts/${sale.body.debt_id}`)).body;
  assert.equal(debt.amount, 500_000);
  assert.equal(debt.status, 'open');
  assert.equal((await business.owner.get('/transactions')).body.total, 0);
  assert.equal(
    (await business.owner.get(`/sales/${sale.body.sale.id}`)).body.payment_status,
    'open',
  );
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

test('BR-005: voiding a credit sale voids the receivable, its payments, and its invoice', async () => {
  const business = await newBusiness();
  await business.owner.put('/business', {
    name: 'Toko Uji',
    address: 'Jl. Uji 1',
    taxpayer_type: 'individual',
    period_start_day: 1,
    tax_rate: 0.5,
    tax_threshold: 500_000_000,
  });
  const contact = await addContact(business);
  const sale = await business.owner.post('/sales', {
    items: [{ description: 'Jasa', qty: 1, unit_price: 100_000 }],
    payment_type: 'credit',
    contact_id: contact.id,
    sale_date: '2026-10-01',
    due_date: '2026-12-31',
  });
  const invoice = await business.owner.post('/invoices', {
    sale_id: sale.body.sale.id,
    issue_date: '2026-10-01',
  });
  await business.owner.post(`/debts/${sale.body.debt_id}/payments`, {
    amount: 40_000,
    account_id: business.kas.id,
    paid_on: '2026-10-02',
  });
  assert.equal(await balanceOf(business, 'Kas'), 40_000);

  await business.owner.post(`/sales/${sale.body.sale.id}/void`);
  assert.equal(await balanceOf(business, 'Kas'), 0);
  const debt = (await business.owner.get(`/debts/${sale.body.debt_id}`)).body;
  assert.equal(debt.status, 'void');
  assert.equal(debt.payments[0].is_void, true);
  assert.equal((await business.owner.get(`/invoices/${invoice.body.id}`)).body.status, 'void');
  assert.equal((await business.owner.get('/contacts')).body.items[0].receivable_balance, 0);
});

test('AC-009 / BR-011: Staff never receive cost price or margin', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  const product = await addProduct(business);

  for (const body of [
    (await staff.client.get(`/products/${product.id}`)).body,
    (await staff.client.get('/products')).body.items[0],
  ]) {
    assert.equal(body.cost_price, undefined);
    assert.equal(body.margin, undefined);
    assert.equal(body.sell_price, 10_000);
  }
  assert.equal((await staff.client.get(`/products/${product.id}/movements`)).status, 403);
  assert.equal((await staff.client.post('/products', {})).status, 403);

  const sale = await staff.client.post('/sales', {
    items: [{ product_id: product.id, qty: 1, unit_price: 10_000 }],
    payment_type: 'paid',
    account_id: business.kas.id,
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.body.sale.items[0].unit_cost, undefined);
  assert.equal(sale.body.sale.items[0].line_cost, undefined);
  assert.ok(
    !JSON.stringify((await staff.client.get(`/sales/${sale.body.sale.id}`)).body).includes('cost'),
  );

  const owned = (await business.owner.get(`/products/${product.id}`)).body;
  assert.equal(owned.cost_price, 6_000);
  assert.equal(owned.margin, 4_000);
});

test('Staff see only their own sales and cannot void', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  const ownerSale = await paidSale(business, [{ description: 'A', qty: 1, unit_price: 100 }]);
  assert.equal((await staff.client.get('/sales')).body.total, 0);
  assert.equal((await staff.client.get(`/sales/${ownerSale.body.sale.id}`)).status, 404);
  assert.equal((await staff.client.post(`/sales/${ownerSale.body.sale.id}/void`)).status, 403);
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

test('AC-012: a contact with an open receivable cannot be archived', async () => {
  const business = await newBusiness();
  const contact = await addContact(business);
  const debt = await business.owner.post('/debts', {
    type: 'receivable',
    contact_id: contact.id,
    amount: 1000,
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
  });
  const refused = await business.owner.put(`/contacts/${contact.id}`, { is_archived: true });
  assert.equal(refused.status, 409);
  assert.equal(
    refused.body.error.message,
    'Kontak masih punya hutang atau piutang yang belum lunas.',
  );

  await business.owner.post(`/debts/${debt.body.id}/payments`, {
    amount: 1000,
    account_id: business.kas.id,
    paid_on: '2026-10-02',
  });
  assert.equal(
    (await business.owner.put(`/contacts/${contact.id}`, { is_archived: true })).status,
    200,
  );
});

test('AC-013 / BR-007: partial payment, overpayment refusal, then paid; voiding restores', async () => {
  const business = await newBusiness();
  const contact = await addContact(business);
  const { body: debt } = await business.owner.post('/debts', {
    type: 'receivable',
    contact_id: contact.id,
    amount: 1_000_000,
    issue_date: '2026-10-01',
    due_date: '2030-10-31',
  });
  const partial = await business.owner.post(`/debts/${debt.id}/payments`, {
    amount: 400_000,
    account_id: business.kas.id,
    paid_on: '2026-10-02',
  });
  assert.equal(partial.status, 201);
  assert.equal(partial.body.debt.status, 'partial');
  assert.equal(partial.body.debt.remaining, 600_000);

  const over = await business.owner.post(`/debts/${debt.id}/payments`, {
    amount: 600_001,
    account_id: business.kas.id,
    paid_on: '2026-10-02',
  });
  assert.equal(over.status, 422);
  assert.equal(over.body.error.message, 'Pembayaran melebihi sisa tagihan (Rp600.000).');

  const early = await business.owner.post(`/debts/${debt.id}/payments`, {
    amount: 1,
    account_id: business.kas.id,
    paid_on: '2026-09-30',
  });
  assert.equal(early.status, 400);

  const full = await business.owner.post(`/debts/${debt.id}/payments`, {
    amount: 600_000,
    account_id: business.kas.id,
    paid_on: '2026-10-03',
  });
  assert.equal(full.body.debt.status, 'paid');
  const closed = await business.owner.post(`/debts/${debt.id}/payments`, {
    amount: 1,
    account_id: business.kas.id,
    paid_on: '2026-10-03',
  });
  assert.equal(closed.status, 409);

  const detail = (await business.owner.get(`/debts/${debt.id}`)).body;
  const reopened = await business.owner.post(
    `/debts/${debt.id}/payments/${detail.payments[0].id}/void`,
  );
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.status, 'partial');
  assert.equal(reopened.body.remaining, 600_000);
  assert.equal(await balanceOf(business, 'Kas'), 400_000);
});

test('BR-007: an unpaid debt past its due date is flagged overdue with its days', async () => {
  const business = await newBusiness();
  const contact = await addContact(business);
  await business.owner.post('/debts', {
    type: 'receivable',
    contact_id: contact.id,
    amount: 1000,
    issue_date: '2020-01-01',
    due_date: '2020-01-02',
  });
  const { items, remaining } = (await business.owner.get('/debts?status=overdue')).body;
  assert.equal(items.length, 1);
  assert.ok(items[0].days_overdue > 365);
  assert.equal(remaining, 1000);
});

test('AC-014 / BR-008: debt payments move cash but add nothing to profit and loss', async () => {
  const business = await newBusiness();
  const contact = await addContact(business);
  const receivable = await business.owner.post('/debts', {
    type: 'receivable',
    contact_id: contact.id,
    amount: 1_000_000,
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
  });
  const payable = await business.owner.post('/debts', {
    type: 'payable',
    contact_id: contact.id,
    amount: 300_000,
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    category_id: business.category('Sewa').id,
  });
  const pay = (id, amount) =>
    business.owner.post(`/debts/${id}/payments`, {
      amount,
      account_id: business.kas.id,
      paid_on: '2026-10-10',
    });
  await pay(receivable.body.id, 400_000);
  await pay(payable.body.id, 300_000);
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

test('Staff see receivables only and can record a payment without any balance', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  const contact = await addContact(business);
  const receivable = await business.owner.post('/debts', {
    type: 'receivable',
    contact_id: contact.id,
    amount: 1000,
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
  });
  const payable = await business.owner.post('/debts', {
    type: 'payable',
    contact_id: contact.id,
    amount: 1000,
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    category_id: business.category('Sewa').id,
  });
  const list = (await staff.client.get('/debts?type=payable')).body;
  assert.ok(list.items.every((debt) => debt.type === 'receivable'));
  assert.equal((await staff.client.get(`/debts/${payable.body.id}`)).status, 404);
  assert.equal(
    (
      await staff.client.post(`/debts/${payable.body.id}/payments`, {
        amount: 1,
        account_id: business.kas.id,
        paid_on: '2026-10-02',
      })
    ).status,
    404,
  );

  const paid = await staff.client.post(`/debts/${receivable.body.id}/payments`, {
    amount: 500,
    account_id: business.kas.id,
    paid_on: '2026-10-02',
  });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.account_balance, undefined);
  assert.equal((await staff.client.get('/contacts')).body.items[0].payable_balance, undefined);
});

async function businessWithAddress() {
  const business = await newBusiness();
  await business.owner.put('/business', {
    name: 'Toko Uji',
    address: 'Jl. Uji 1, Bandung',
    taxpayer_type: 'individual',
    period_start_day: 1,
    tax_rate: 0.5,
    tax_threshold: 500_000_000,
    payment_info: 'BCA 123',
  });
  return business;
}

const anySale = (business) =>
  paidSale(business, [{ description: 'Jasa', qty: 1, unit_price: 100_000 }]);

test('AC-015 / BR-006: the first invoice is INV/2026/0001; numbers rise and a void is not reused', async () => {
  const business = await businessWithAddress();
  const first = await business.owner.post('/invoices', {
    sale_id: (await anySale(business)).body.sale.id,
    issue_date: '2026-03-01',
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.number, 'INV/2026/0001');
  assert.equal(first.body.status, 'paid', 'a sale paid at sale time is a paid invoice');

  const voided = await business.owner.put(`/invoices/${first.body.id}`, { status: 'void' });
  assert.equal(voided.body.status, 'void');
  const second = await business.owner.post('/invoices', {
    sale_id: (await anySale(business)).body.sale.id,
    issue_date: '2026-03-02',
  });
  assert.equal(second.body.number, 'INV/2026/0002');
  const nextYear = await business.owner.post('/invoices', {
    sale_id: (await anySale(business)).body.sale.id,
    issue_date: '2027-01-02',
  });
  assert.equal(nextYear.body.number, 'INV/2027/0001');
});

test('BR-006: concurrent invoices get consecutive numbers with no gap or repeat', async () => {
  const business = await businessWithAddress();
  const sales = [];
  for (let i = 0; i < 8; i += 1) sales.push((await anySale(business)).body.sale.id);
  const results = await Promise.all(
    sales.map((sale_id) => business.owner.post('/invoices', { sale_id, issue_date: '2026-05-01' })),
  );
  const numbers = results.map((result) => result.body.number).sort();
  assert.deepEqual(
    numbers,
    Array.from({ length: 8 }, (_, i) => `INV/2026/000${i + 1}`),
  );
});

test('invoices: one per sale, address required, status follows the receivable, PDF downloads', async () => {
  const noAddress = await newBusiness();
  const refused = await noAddress.owner.post('/invoices', {
    sale_id: (await anySale(noAddress)).body.sale.id,
    issue_date: '2026-03-01',
  });
  assert.equal(refused.status, 422);
  assert.equal(
    refused.body.error.message,
    'Lengkapi alamat usaha di Pengaturan sebelum membuat faktur.',
  );

  const business = await businessWithAddress();
  const contact = await addContact(business);
  const sale = await business.owner.post('/sales', {
    items: [{ description: 'Jasa', qty: 1, unit_price: 100_000 }],
    payment_type: 'credit',
    contact_id: contact.id,
    sale_date: '2026-10-01',
    due_date: '2026-12-31',
  });
  const invoice = await business.owner.post('/invoices', {
    sale_id: sale.body.sale.id,
    issue_date: '2026-10-01',
    due_date: '2026-12-31',
  });
  assert.equal(invoice.body.status, 'issued');
  const second = await business.owner.post('/invoices', {
    sale_id: sale.body.sale.id,
    issue_date: '2026-10-01',
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.message, 'Penjualan ini sudah punya faktur.');

  const pay = await business.owner.post(`/debts/${sale.body.debt_id}/payments`, {
    amount: 100_000,
    account_id: business.kas.id,
    paid_on: '2026-10-02',
  });
  assert.equal(pay.status, 201);
  assert.equal((await business.owner.get(`/invoices/${invoice.body.id}`)).body.status, 'paid');

  const pdf = await business.owner.get(`/invoices/${invoice.body.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
});
