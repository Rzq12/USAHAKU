import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  addProduct,
  insertLegacyContact,
  newBusiness,
  newClient,
  paidSale,
  pool,
  startApi,
  stopApi,
} from './support.js';

before(startApi);
after(stopApi);

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

const expense = (business, overrides = {}) =>
  business.owner.post('/transactions', {
    type: 'expense',
    amount: 1000,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: today,
    tags: [],
    ...overrides,
  });

async function restockExpense(business) {
  const product = await addProduct(business, { cost_price: 5000, opening_stock: 0 });
  await business.owner.post(`/products/${product.id}/stock`, {
    kind: 'restock',
    qty: 10,
    record_expense: true,
    account_id: business.kas.id,
  });
  const list = (await business.owner.get('/transactions?type=expense')).body.items;
  return list.find((item) => item.source_type === 'restock');
}

const sameExcept = (transaction, overrides) => ({
  amount: transaction.amount,
  account_id: transaction.account_id,
  occurred_on: transaction.occurred_on,
  category_id: transaction.category_id,
  transfer_account_id: null,
  contact_id: transaction.contact_id,
  note: transaction.note,
  tags: [],
  ...overrides,
});

test('a stock purchase keeps its category, so it can never start reducing profit', async () => {
  const business = await newBusiness();
  const restock = await restockExpense(business);
  const moved = await business.owner.put(
    `/transactions/${restock.id}`,
    sameExcept(restock, { category_id: business.category('Sewa').id }),
  );
  assert.equal(moved.status, 422);
  assert.equal((await business.owner.get('/dashboard')).body.today_profit, 0);

  const noted = await business.owner.put(
    `/transactions/${restock.id}`,
    sameExcept(restock, { note: 'Beli di pasar' }),
  );
  assert.equal(noted.status, 200);
});

test('another business category cannot be attached, and the owner can still delete it', async () => {
  const attacker = await newBusiness();
  const victim = await newBusiness();
  const created = await victim.owner.post('/categories', {
    name: 'Kategori Korban',
    type: 'expense',
    pl_group: 'operating_expense',
  });
  const restock = await restockExpense(attacker);
  const attached = await attacker.owner.put(
    `/transactions/${restock.id}`,
    sameExcept(restock, { category_id: created.body.id }),
  );
  assert.notEqual(attached.status, 200);
  assert.equal((await victim.owner.del(`/categories/${created.body.id}`)).status, 204);
});

test('contact_id is refused on new records and cannot be swapped on old ones', async () => {
  const owner = await newBusiness();
  const other = await newBusiness();
  const foreign = await insertLegacyContact(other, { name: 'Pelanggan Lain' });

  const unknown = await expense(owner, { contact_id: randomUUID() });
  assert.equal(unknown.status, 400);
  assert.ok(unknown.body.error.fields.contact_id);
  assert.equal((await expense(owner, { contact_id: foreign })).status, 400);

  const created = (await expense(owner)).body.transaction;
  const swapped = await owner.owner.put(
    `/transactions/${created.id}`,
    sameExcept(created, { contact_id: foreign }),
  );
  assert.equal(swapped.status, 400);
});

test('names from another business never appear through a stored cross-tenant reference', async () => {
  const owner = await newBusiness();
  const other = await newBusiness();
  const foreign = await insertLegacyContact(other, { name: 'Rahasia Usaha Lain' });
  const created = (await expense(owner)).body.transaction;
  // A row written before this fix could still point at another business's contact.
  await pool.query('UPDATE transactions SET contact_id = $1 WHERE id = $2', [foreign, created.id]);
  const read = (await owner.owner.get(`/transactions/${created.id}`)).body;
  assert.equal(read.contact_name, null);
});

test('an old transaction on an archived account can still have its note changed', async () => {
  const business = await newBusiness();
  const created = (await expense(business, { account_id: business.bank.id })).body.transaction;
  await business.owner.post(`/accounts/${business.bank.id}/archive`, { is_archived: true });
  const edited = await business.owner.put(
    `/transactions/${created.id}`,
    sameExcept(created, { note: 'catatan baru' }),
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.body.transaction.note, 'catatan baru');
});

test('archiving an account with money keeps that money in the total balance', async () => {
  const business = await newBusiness();
  await business.owner.post('/transactions', {
    type: 'income',
    amount: 700_000,
    account_id: business.bank.id,
    category_id: business.category('Pendapatan Lain').id,
    occurred_on: today,
    tags: [],
  });
  await business.owner.post(`/accounts/${business.bank.id}/archive`, { is_archived: true });
  const accounts = (await business.owner.get('/accounts')).body;
  assert.equal(accounts.total_balance, 700_000);
  assert.ok(accounts.items.every((account) => !account.is_archived));
});

test('quantities and totals beyond what the books can hold exactly are refused', async () => {
  const business = await newBusiness();
  const huge = await paidSale(business, [
    { product_id: null, description: 'Jasa', qty: 1e10, unit_price: 1 },
  ]);
  assert.equal(huge.status, 400);
  const tooMuch = await paidSale(business, [
    { product_id: null, description: 'Mahal', qty: 999_999, unit_price: 999_999_999_999 },
  ]);
  assert.equal(tooMuch.status, 400);
  const lines = Array.from({ length: 3 }, () => ({
    product_id: null,
    description: 'X',
    qty: 1,
    unit_price: 999_999_999_999,
  }));
  assert.equal((await paidSale(business, lines)).status, 400);
  const stock = await business.owner.post('/products', {
    name: 'Besar',
    unit: 'pcs',
    sell_price: 1,
    cost_price: 1,
    track_stock: true,
    opening_stock: 1e10,
  });
  assert.equal(stock.status, 400);
  assert.equal((await business.owner.get('/sales')).body.total, 0);
});

test('a sale dated before 2000 is refused as a likely mistyped year', async () => {
  const business = await newBusiness();
  const old = await paidSale(
    business,
    [{ product_id: null, description: 'Jasa', qty: 1, unit_price: 5 }],
    { sale_date: '1900-01-01' },
  );
  assert.equal(old.status, 400);
});

test('sales by product keeps the name the item had when it was sold', async () => {
  const business = await newBusiness();
  const product = await addProduct(business, { name: 'Kopi Susu', opening_stock: 5 });
  await paidSale(business, [{ product_id: product.id, qty: 1, unit_price: 10_000 }]);
  await business.owner.put(`/products/${product.id}`, { name: 'Es Teh' });
  const report = (await business.owner.get(`/reports/sales-by-product?from=${today}&to=${today}`))
    .body;
  assert.deepEqual(
    report.rows.map((row) => row.name),
    ['Kopi Susu', 'Total'],
  );
});

test('a removed report answers 404 like the other removed routes', async () => {
  const business = await newBusiness();
  const response = await business.owner.get(`/reports/receivable-aging?from=${today}&to=${today}`);
  assert.equal(response.status, 404);
});

test('concurrent wrong passwords still lock the account', async () => {
  const business = await newBusiness();
  const attempts = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      newClient().post('/auth/login', { email: business.email, password: `salah-${index}` }),
    ),
  );
  assert.ok(attempts.every((response) => response.status === 401));
  const { rows } = await pool.query(
    'SELECT failed_login_count, locked_until FROM users WHERE email = $1',
    [business.email],
  );
  assert.ok(rows[0].failed_login_count >= 5);
  assert.ok(rows[0].locked_until);
});

test('change password refuses the same password and shares the sign-in lockout', async () => {
  const business = await newBusiness();
  const same = await business.owner.post('/auth/change-password', {
    current_password: 'kata-sandi-uji',
    new_password: 'kata-sandi-uji',
  });
  assert.equal(same.status, 400);
  assert.ok(same.body.error.fields.new_password);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await business.owner.post('/auth/change-password', {
      current_password: `tebakan-${attempt}`,
      new_password: 'sandi-baru-123',
    });
  }
  const locked = await business.owner.post('/auth/change-password', {
    current_password: 'kata-sandi-uji',
    new_password: 'sandi-baru-123',
  });
  assert.equal(locked.status, 401);
  assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
});

test('a session older than the absolute limit is refused even while still in use', async () => {
  const business = await newBusiness();
  await pool.query(
    `UPDATE sessions SET created_at = now() - interval '31 days'
     WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [business.email],
  );
  assert.equal((await business.owner.get('/auth/me')).status, 401);
});

test('a duplicate email is refused before any password hashing', async () => {
  const business = await newBusiness();
  const again = await newClient().post('/auth/register', {
    business_name: 'Toko Kedua',
    name: 'Pemilik Lain',
    email: business.email,
    password: 'kata-sandi-lain',
  });
  assert.equal(again.status, 400);
  assert.equal(again.body.error.fields.email, 'Email sudah terdaftar.');
});

test('a sale resent with the same Idempotency-Key is stored once', async () => {
  const business = await newBusiness();
  const body = {
    items: [{ product_id: null, description: 'Kopi', qty: 1, unit_price: 5000 }],
    account_id: business.kas.id,
  };
  const send = () =>
    business.owner.raw('POST', '/sales', {
      json: body,
      headers: { 'Idempotency-Key': 'form-1' },
    });
  const first = await send();
  const second = await send();
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.sale.id, first.body.sale.id);
  assert.equal((await business.owner.get('/sales')).body.total, 1);
});

test('the data export carries tags, receipt list, business profile, and rules', async () => {
  const business = await newBusiness();
  await expense(business, { tags: ['penting'] });
  const response = await business.owner.get('/export/data');
  assert.equal(response.status, 200);
  const text = response.body.toString('latin1');
  for (const name of ['tags.csv', 'transaction_tags.csv', 'attachments.csv', 'business.csv']) {
    assert.ok(text.includes(name), `${name} missing`);
  }
});
