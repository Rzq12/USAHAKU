import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newBusiness, pool, startApi, stopApi } from './support.js';

before(startApi);
after(stopApi);

const expense = (business, overrides = {}) => ({
  type: 'expense',
  amount: 250_000,
  account_id: business.kas.id,
  category_id: business.category('Sewa').id,
  occurred_on: '2026-10-05',
  ...overrides,
});

test('AC-005 / BR-003: balance is opening balance minus an expense', async () => {
  const business = await newBusiness();
  const account = await business.owner.post('/accounts', {
    name: 'Kas Toko',
    type: 'cash',
    opening_balance: 1_000_000,
  });
  const saved = await business.owner.post(
    '/transactions',
    expense(business, { account_id: account.body.id }),
  );
  assert.equal(saved.status, 201);
  assert.equal(saved.body.account_balance, 750_000);

  const { items, total_balance } = (await business.owner.get('/accounts')).body;
  assert.equal(items.find((a) => a.id === account.body.id).balance, 750_000);
  assert.equal(total_balance, 750_000);
});

test('BR-001: decimals, zero, and negatives are rejected and nothing is saved', async () => {
  const business = await newBusiness();
  for (const amount of [250_000.5, 0, -100, 1_000_000_000_000]) {
    const response = await business.owner.post('/transactions', expense(business, { amount }));
    assert.equal(response.status, 400, String(amount));
    assert.ok(response.body.error.fields.amount);
  }
  assert.equal((await business.owner.get('/transactions')).body.total, 0);
});

test('AC-006 / BR-002: a transfer moves balance and stays out of totals and reports', async () => {
  const business = await newBusiness();
  await business.owner.put(`/accounts/${business.kas.id}`, {
    name: 'Kas',
    type: 'cash',
    opening_balance: 500_000,
  });
  const transfer = await business.owner.post('/transactions', {
    type: 'transfer',
    amount: 100_000,
    account_id: business.kas.id,
    transfer_account_id: business.bank.id,
    occurred_on: '2026-10-05',
  });
  assert.equal(transfer.status, 201);

  const { items } = (await business.owner.get('/accounts')).body;
  assert.equal(items.find((a) => a.name === 'Kas').balance, 400_000);
  assert.equal(items.find((a) => a.name === 'Bank').balance, 100_000);

  const list = (await business.owner.get('/transactions')).body;
  assert.deepEqual(list.totals, { income: 0, expense: 0, net: 0 });

  const range = 'from=2026-10-01&to=2026-10-31';
  const pl = (await business.owner.get(`/reports/profit-loss?${range}`)).body;
  assert.equal(pl.totals.net_profit, 0);
  assert.equal(pl.is_empty, true);
  const flow = (await business.owner.get(`/reports/cash-flow?${range}`)).body;
  assert.equal(flow.totals.money_in, 0);
  assert.equal(flow.totals.money_out, 0);
  assert.equal(flow.totals.transfer_net, 0);
});

test('BR-002: a transfer needs two different accounts', async () => {
  const business = await newBusiness();
  const same = await business.owner.post('/transactions', {
    type: 'transfer',
    amount: 100,
    account_id: business.kas.id,
    transfer_account_id: business.kas.id,
    occurred_on: '2026-10-05',
  });
  assert.equal(same.status, 400);
  assert.equal(same.body.error.fields.transfer_account_id, 'Akun asal dan tujuan harus berbeda.');
});

test('BR-003: an account with transactions is archived, not deleted', async () => {
  const business = await newBusiness();
  await business.owner.post('/transactions', expense(business));
  const refused = await business.owner.del(`/accounts/${business.kas.id}`);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.message, 'Akun sudah punya transaksi. Arsipkan saja.');

  const archived = await business.owner.post(`/accounts/${business.kas.id}/archive`);
  assert.equal(archived.body.is_archived, true);
  assert.ok(!(await business.owner.get('/accounts')).body.items.some((a) => a.name === 'Kas'));

  const onArchived = await business.owner.post('/transactions', expense(business));
  assert.equal(onArchived.status, 400);

  const empty = await business.owner.post('/accounts', {
    name: 'Kosong',
    type: 'ewallet',
    opening_balance: 0,
  });
  assert.equal((await business.owner.del(`/accounts/${empty.body.id}`)).status, 204);
});

test('soft delete takes a transaction out of balances; list filters work', async () => {
  const business = await newBusiness();
  const first = await business.owner.post(
    '/transactions',
    expense(business, { note: 'bayar sewa toko', tags: ['Toko', 'toko'] }),
  );
  await business.owner.post(
    '/transactions',
    expense(business, { amount: 1000, occurred_on: '2026-09-01' }),
  );

  const filtered = (await business.owner.get('/transactions?q=sewa&from=2026-10-01&tag=toko')).body;
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.items[0].tags, ['toko']);
  assert.equal(filtered.totals.expense, 250_000);

  assert.equal(
    (await business.owner.del(`/transactions/${first.body.transaction.id}`)).status,
    204,
  );
  const { items } = (await business.owner.get('/accounts')).body;
  assert.equal(items.find((a) => a.name === 'Kas').balance, -1000);
  assert.equal(
    (await business.owner.get(`/transactions/${first.body.transaction.id}`)).status,
    404,
  );
});

test('an excluded transaction stays listed and leaves the report totals', async () => {
  const business = await newBusiness();
  const created = await business.owner.post('/transactions', expense(business));
  const id = created.body.transaction.id;
  const edit = { ...expense(business), tags: [], is_excluded: true };
  delete edit.type;
  await business.owner.put(`/transactions/${id}`, edit);

  const list = (await business.owner.get('/transactions')).body;
  assert.equal(list.total, 1);
  assert.equal(list.totals.expense, 0);
  const pl = (await business.owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31')).body;
  assert.equal(pl.totals.operating_expenses, 0);
});

test('AC-008: a keyword rule suggests the category; priority, then keyword length, decide', async () => {
  const business = await newBusiness();
  const utilities = business.category('Listrik dan Utilitas');
  const supplies = business.category('Perlengkapan');
  const transport = business.category('Transportasi');
  await business.owner.post('/category-rules', {
    keyword: 'Listrik',
    category_id: utilities.id,
    priority: 10,
  });

  const match = await business.owner.post('/category-rules/test', { note: 'bayar LISTRIK toko' });
  assert.equal(match.body.matched_category, utilities.id);
  const none = await business.owner.post('/category-rules/test', { note: 'beli kopi' });
  assert.equal(none.body.matched_category, null);

  await business.owner.post('/category-rules', {
    keyword: 'toko',
    category_id: supplies.id,
    priority: 50,
  });
  const higher = await business.owner.post('/category-rules/test', { note: 'bayar listrik toko' });
  assert.equal(higher.body.matched_category, supplies.id);

  await business.owner.post('/category-rules', {
    keyword: 'listrik toko',
    category_id: transport.id,
    priority: 50,
  });
  const longer = await business.owner.post('/category-rules/test', { note: 'bayar listrik toko' });
  assert.equal(longer.body.matched_category, transport.id);
});

test('categories in use are archived, not deleted; rules cannot target archived ones', async () => {
  const business = await newBusiness();
  const rent = business.category('Sewa');
  await business.owner.post('/transactions', expense(business));
  const refused = await business.owner.del(`/categories/${rent.id}`);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.message, 'Kategori sudah dipakai. Arsipkan saja.');

  await business.owner.put(`/categories/${rent.id}`, { is_archived: true });
  const rule = await business.owner.post('/category-rules', {
    keyword: 'sewa',
    category_id: rent.id,
    priority: 1,
  });
  assert.equal(rule.status, 400);

  const fresh = await business.owner.post('/categories', {
    name: 'Baru',
    type: 'expense',
    pl_group: 'operating_expense',
  });
  assert.equal((await business.owner.del(`/categories/${fresh.body.id}`)).status, 204);

  const duplicate = await business.owner.post('/categories', {
    name: 'Gaji',
    type: 'expense',
    pl_group: 'operating_expense',
  });
  assert.equal(duplicate.status, 400);
  assert.ok(duplicate.body.error.fields.name);
});

test('receipts: real image bytes are stored and served to the business; others are refused', async () => {
  const business = await newBusiness();
  const created = await business.owner.post('/transactions', expense(business));
  const id = created.body.transaction.id;

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const form = new FormData();
  form.append('receipt', new Blob([png], { type: 'image/png' }), 'struk.png');
  const uploaded = await business.owner.postForm(`/transactions/${id}/receipt`, form);
  assert.equal(uploaded.status, 200);
  assert.ok(uploaded.body.attachment_id);

  const served = await business.owner.get(`/transactions/${id}/receipt`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');

  const other = await newBusiness();
  assert.equal((await other.owner.get(`/transactions/${id}/receipt`)).status, 404);

  const fake = new FormData();
  fake.append('receipt', new Blob(['%PDF-1.7'], { type: 'image/png' }), 'struk.png');
  const refused = await business.owner.postForm(`/transactions/${id}/receipt`, fake);
  assert.equal(refused.status, 400);

  const huge = new FormData();
  huge.append('receipt', new Blob([Buffer.alloc(6 * 1024 * 1024)]), 'besar.jpg');
  const tooLarge = await business.owner.postForm(`/transactions/${id}/receipt`, huge);
  assert.equal(tooLarge.status, 400);
  assert.equal(tooLarge.body.error.fields.receipt, 'Foto melebihi 5 MB.');
  assert.equal(
    (await business.owner.get(`/transactions/${id}`)).status,
    200,
    'transaction survives',
  );
});

test('AC-025: the audit log shows who changed a transaction with old and new values', async () => {
  const business = await newBusiness();
  const created = await business.owner.post('/transactions', expense(business));
  const id = created.body.transaction.id;
  const edit = { ...expense(business), amount: 300_000, tags: [] };
  delete edit.type;
  await business.owner.put(`/transactions/${id}`, edit);

  const { rows: items } = await pool.query(
    `SELECT a.created_at, a.detail, u.name AS user_name
     FROM audit_logs a JOIN users u ON u.id = a.user_id
     WHERE a.entity_type = 'transaction' AND a.action = 'update' AND a.entity_id = $1`,
    [id],
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].user_name, 'Pemilik Uji');
  assert.ok(items[0].created_at);
  assert.deepEqual(items[0].detail.amount, { old: 250_000, new: 300_000 });
});
