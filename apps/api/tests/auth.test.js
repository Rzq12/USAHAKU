import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { insertLegacyUser, newBusiness, newClient, pool, startApi, stopApi } from './support.js';

const migration = readFileSync(
  new URL('../../../db/migrations/003_single_role.sql', import.meta.url),
  'utf8',
);

before(startApi);
after(stopApi);

test('AC-001: registration creates a business, an Owner, defaults, and a session', async () => {
  const { owner, kas, bank, category } = await newBusiness();
  const me = await owner.get('/auth/me');
  assert.equal(me.status, 200);
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [me.body.user.id]);
  assert.equal(rows[0].role, 'owner');
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
  for (const path of [
    '/accounts',
    '/transactions',
    '/dashboard',
    '/products',
    '/reports/profit-loss',
  ]) {
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

test('audit: login and failed login are logged, never with secrets', async () => {
  const business = await newBusiness();
  await newClient().post('/auth/login', { email: business.email, password: 'salah-sandi' });
  await newClient().post('/auth/login', { email: business.email, password: 'kata-sandi-uji' });

  const { rows: items } = await pool.query(
    `SELECT a.action, a.detail FROM audit_logs a
     WHERE a.business_id = (SELECT business_id FROM users WHERE email = $1)`,
    [business.email],
  );
  const actions = items.map((entry) => entry.action);
  for (const action of ['login', 'login_failed']) {
    assert.ok(actions.includes(action), action);
  }

  const { rows } = await pool.query('SELECT detail::text AS text FROM audit_logs');
  for (const { text } of rows) {
    assert.ok(!text?.includes('kata-sandi-uji') && !text?.includes('argon2'));
  }
});

test('the single-role migration disables non-Owners and ends their sessions', async () => {
  const business = await newBusiness();
  const staff = await insertLegacyUser(business, 'staff');
  const accountant = await insertLegacyUser(business, 'accountant');
  await newClient().post('/auth/login', { email: staff.email, password: staff.password });
  await newClient().post('/auth/login', { email: accountant.email, password: accountant.password });

  await pool.query(migration);

  const { rows } = await pool.query(
    'SELECT id, role, is_active FROM users WHERE business_id = (SELECT business_id FROM users WHERE id = $1)',
    [staff.id],
  );
  assert.deepEqual(
    rows.find((row) => row.id === staff.id),
    { id: staff.id, role: 'staff', is_active: false },
  );
  assert.deepEqual(
    rows.find((row) => row.id === accountant.id),
    {
      id: accountant.id,
      role: 'accountant',
      is_active: false,
    },
  );
  assert.equal(rows.find((row) => row.role === 'owner').is_active, true);
  const sessions = await pool.query('SELECT id FROM sessions WHERE user_id = ANY($1)', [
    [staff.id, accountant.id],
  ]);
  assert.equal(sessions.rows.length, 0);
  assert.equal((await business.owner.get('/auth/me')).status, 200);
});

test('a disabled old account cannot use an open session or log in', async () => {
  const business = await newBusiness();
  const staff = await insertLegacyUser(business, 'staff');
  const client = newClient();
  await client.post('/auth/login', { email: staff.email, password: staff.password });
  assert.equal((await client.get('/auth/me')).status, 200);

  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [staff.id]);
  assert.equal((await client.get('/auth/me')).status, 401);

  const login = await newClient().post('/auth/login', {
    email: staff.email,
    password: staff.password,
  });
  assert.equal(login.status, 401);
  assert.equal(login.body.error.message, 'Email atau kata sandi salah.');
});

test('the users route is gone and /auth/me carries no role', async () => {
  const { owner } = await newBusiness();
  assert.equal((await owner.get('/users')).status, 404);
  const me = (await owner.get('/auth/me')).body;
  assert.deepEqual(Object.keys(me.user).sort(), ['email', 'id', 'name']);
});

test('reports, settings, and stock stay available to the one remaining role', async () => {
  const { owner } = await newBusiness();
  assert.equal((await owner.get('/reports/profit-loss?from=2026-10-01&to=2026-10-31')).status, 200);
  assert.equal((await owner.get('/business')).status, 200);
  assert.equal((await owner.get('/export/data')).status, 200);
});
