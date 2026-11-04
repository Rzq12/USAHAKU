import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, newBusiness, newClient, pool, startApi, stopApi } from './support.js';

before(startApi);
after(stopApi);

test('AC-001: registration creates a business, an Owner, defaults, and a session', async () => {
  const { owner, kas, bank, category } = await newBusiness();
  const me = await owner.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'owner');
  assert.equal(me.body.business.name, 'Toko Uji');
  assert.equal(me.body.business.period_start_day, 1);
  assert.ok(kas && bank);
  assert.ok(category('Penjualan') && category('Pajak') && category('Pembelian Stok'));
});

test('registration rejects a duplicate email and a password equal to the email', async () => {
  const { email } = await newBusiness();
  const duplicate = await newClient().post('/auth/register', {
    business_name: 'Toko Lain',
    name: 'Orang Lain',
    email: email.toUpperCase(),
    password: 'kata-sandi-lain',
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error.fields.email, 'Email sudah terdaftar.');

  const sameAsEmail = await newClient().post('/auth/register', {
    business_name: 'Toko Lain',
    name: 'Orang Lain',
    email: 'sama@contoh.id',
    password: 'sama@contoh.id',
  });
  assert.equal(sameAsEmail.status, 400);
});

test('wrong credentials return one generic message', async () => {
  const { email } = await newBusiness();
  const wrongPassword = await newClient().post('/auth/login', { email, password: 'salah-sandi' });
  const noUser = await newClient().post('/auth/login', {
    email: 'tidak-ada@contoh.id',
    password: 'salah-sandi',
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.error.message, 'Email atau kata sandi salah.');
  assert.equal(noUser.body.error.message, wrongPassword.body.error.message);
});

test('AC-002: after five failures the sixth attempt is rejected even with the right password', async () => {
  const { email } = await newBusiness();
  for (let i = 0; i < 5; i += 1) {
    await newClient().post('/auth/login', { email, password: 'salah-sandi' });
  }
  const sixth = await newClient().post('/auth/login', { email, password: 'kata-sandi-uji' });
  assert.equal(sixth.status, 401);
  assert.equal(sixth.body.error.code, 'ACCOUNT_LOCKED');
  assert.match(sixth.body.error.message, /Coba lagi dalam \d+ menit/);
});

test('AC-003: deactivating a user ends the open session immediately', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  assert.equal((await staff.client.get('/auth/me')).status, 200);

  const update = await business.owner.put(`/users/${staff.id}`, { is_active: false });
  assert.equal(update.status, 200);
  assert.equal((await staff.client.get('/auth/me')).status, 401);

  const login = await newClient().post('/auth/login', {
    email: staff.email,
    password: 'sandi-baru-456',
  });
  assert.equal(login.body.error.message, 'Email atau kata sandi salah.');
});

test('the last active Owner cannot be deactivated or demoted', async () => {
  const { owner } = await newBusiness();
  const { user } = (await owner.get('/auth/me')).body;
  const deactivate = await owner.put(`/users/${user.id}`, { is_active: false });
  assert.equal(deactivate.status, 409);
  assert.equal(deactivate.body.error.message, 'Pemilik terakhir tidak dapat dinonaktifkan.');
  assert.equal((await owner.put(`/users/${user.id}`, { role: 'staff' })).status, 409);
});

test('a temporary password forces a change before any other page', async () => {
  const business = await newBusiness();
  const email = 'kasir-baru@contoh.id';
  await business.owner.post('/users', {
    name: 'Kasir Baru',
    email,
    role: 'staff',
    temporary_password: 'sementara-123',
  });
  const client = newClient();
  const login = await client.post('/auth/login', { email, password: 'sementara-123' });
  assert.equal(login.body.user.must_change_password, true);

  const blocked = await client.get('/products');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

  await client.post('/auth/change-password', {
    current_password: 'sementara-123',
    new_password: 'sandi-baru-456',
  });
  assert.equal((await client.get('/products')).status, 200);
});

test('changing a password ends other sessions; logout ends this one', async () => {
  const { owner, email } = await newBusiness();
  const other = newClient();
  await other.post('/auth/login', { email, password: 'kata-sandi-uji' });
  assert.equal((await other.get('/auth/me')).status, 200);

  const changed = await owner.post('/auth/change-password', {
    current_password: 'kata-sandi-uji',
    new_password: 'kata-sandi-baru',
  });
  assert.equal(changed.status, 200);
  assert.equal((await other.get('/auth/me')).status, 401);
  assert.equal((await owner.get('/auth/me')).status, 200);

  await owner.post('/auth/logout');
  assert.equal((await owner.get('/auth/me')).status, 401);
});

test('every endpoint except register and login needs a session', async () => {
  const anonymous = newClient();
  for (const path of ['/accounts', '/transactions', '/dashboard', '/users', '/audit-logs']) {
    assert.equal((await anonymous.get(path)).status, 401, path);
  }
});

test('state-changing requests without the client header are refused (CSRF)', async () => {
  const { owner } = await newBusiness();
  const response = await owner.raw('POST', '/accounts', {
    json: { name: 'Tanpa Header', type: 'cash', opening_balance: 0 },
    headers: { 'X-Usahaku-Client': '' },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'CSRF');
});

test('roles: non-Owners cannot touch users or settings; Accountant cannot write', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  const accountant = await addUser(business, 'accountant');

  assert.equal((await staff.client.get('/users')).status, 403);
  assert.equal((await accountant.client.get('/users')).status, 403);
  assert.equal((await staff.client.get('/business')).status, 403);
  assert.equal((await accountant.client.get('/business')).status, 200);

  const settings = (await business.owner.get('/business')).body;
  const write = await accountant.client.put('/business', settings);
  assert.equal(write.status, 403);

  const expense = await accountant.client.post('/transactions', {
    type: 'expense',
    amount: 1000,
    account_id: business.kas.id,
    category_id: business.category('Sewa').id,
    occurred_on: '2026-01-01',
  });
  assert.equal(expense.status, 403);
});

test('tenancy: a business cannot read or touch rows of another business', async () => {
  const first = await newBusiness();
  const second = await newBusiness();
  const created = await first.owner.post('/transactions', {
    type: 'expense',
    amount: 5000,
    account_id: first.kas.id,
    category_id: first.category('Sewa').id,
    occurred_on: '2026-01-01',
  });
  const id = created.body.transaction.id;

  assert.equal((await second.owner.get(`/transactions/${id}`)).status, 404);
  assert.equal((await second.owner.del(`/transactions/${id}`)).status, 404);
  assert.equal((await second.owner.get('/transactions')).body.total, 0);
  const crossAccount = await second.owner.post('/transactions', {
    type: 'expense',
    amount: 5000,
    account_id: first.kas.id,
    category_id: second.category('Sewa').id,
    occurred_on: '2026-01-01',
  });
  assert.equal(crossAccount.status, 400);
});

test('audit: login, failed login, and role changes are logged, never with secrets', async () => {
  const business = await newBusiness();
  const staff = await addUser(business, 'staff');
  await newClient().post('/auth/login', { email: staff.email, password: 'salah-sandi' });
  await business.owner.put(`/users/${staff.id}`, { role: 'accountant' });

  const { items } = (await business.owner.get('/audit-logs?limit=100')).body;
  const actions = items.map((entry) => entry.action);
  for (const action of ['login', 'login_failed', 'role_change', 'create']) {
    assert.ok(actions.includes(action), action);
  }
  const roleChange = items.find((entry) => entry.action === 'role_change');
  assert.deepEqual(roleChange.detail.role, { old: 'staff', new: 'accountant' });

  const { rows } = await pool.query('SELECT detail::text AS text FROM audit_logs');
  for (const { text } of rows) {
    assert.ok(!text?.includes('sementara-123') && !text?.includes('argon2'));
  }
});

test('BR-011 settings: tax rate and threshold round-trip through settings', async () => {
  const { owner } = await newBusiness();
  const settings = (await owner.get('/business')).body;
  assert.equal(settings.tax_rate, 0.5);
  assert.equal(settings.tax_threshold, 500_000_000);

  const invalid = await owner.put('/business', {
    name: 'Toko',
    taxpayer_type: 'individual',
    period_start_day: 31,
    tax_rate: 0.5,
    tax_threshold: 500_000_000,
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    invalid.body.error.fields.period_start_day,
    'Tanggal awal periode harus antara 1 dan 28.',
  );

  const saved = await owner.put('/business', {
    name: 'Toko',
    taxpayer_type: 'company',
    period_start_day: 25,
    tax_rate: 1.25,
    tax_threshold: 0,
    npwp: '01.234.567.8-901.000',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.tax_rate, 1.25);
  assert.equal(saved.body.period_start_day, 25);
});
