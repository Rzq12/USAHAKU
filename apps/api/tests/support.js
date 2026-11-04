import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

if (!process.env.TEST_DATABASE_URL?.includes('test')) {
  throw new Error('TEST_DATABASE_URL must point at a test database');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.LOG_REQUESTS = 'false';
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'usahaku-test-uploads');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');

export { pool };

let server;
let baseUrl;

export async function startApi() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await new Promise((resolve) => {
    server = createApp().listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

export async function stopApi() {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}

/** A small HTTP client with its own cookie, like one browser. */
export function newClient() {
  let cookie = '';
  const send = async (method, url, { json, form, headers = {} } = {}) => {
    const response = await fetch(`${baseUrl}/api${url}`, {
      method,
      headers: {
        'X-Usahaku-Client': 'web',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : form,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const body = isJson ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body, headers: response.headers };
  };
  return {
    get: (url) => send('GET', url),
    post: (url, json = {}) => send('POST', url, { json }),
    put: (url, json) => send('PUT', url, { json }),
    del: (url) => send('DELETE', url),
    postForm: (url, form) => send('POST', url, { form }),
    raw: send,
  };
}

const uniqueEmail = (prefix) => `${prefix}-${randomUUID().slice(0, 8)}@contoh.id`;

/** Registers a fresh business so tests never share data. */
export async function newBusiness() {
  const owner = newClient();
  const email = uniqueEmail('pemilik');
  const response = await owner.post('/auth/register', {
    business_name: 'Toko Uji',
    name: 'Pemilik Uji',
    email,
    password: 'kata-sandi-uji',
  });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));

  const accounts = (await owner.get('/accounts')).body.items;
  const categories = (await owner.get('/categories')).body.items;
  return {
    owner,
    email,
    kas: accounts.find((account) => account.name === 'Kas'),
    bank: accounts.find((account) => account.name === 'Bank'),
    category: (name) => categories.find((category) => category.name === name),
  };
}

/** Creates a Staff or Accountant user and logs in through the forced password change. */
export async function addUser(business, role) {
  const email = uniqueEmail(role);
  const created = await business.owner.post('/users', {
    name: `Pengguna ${role}`,
    email,
    role,
    temporary_password: 'sementara-123',
  });
  if (created.status !== 201) throw new Error(JSON.stringify(created.body));
  const client = newClient();
  await client.post('/auth/login', { email, password: 'sementara-123' });
  await client.post('/auth/change-password', {
    current_password: 'sementara-123',
    new_password: 'sandi-baru-456',
  });
  return { client, id: created.body.id, email };
}

export async function addProduct(business, overrides = {}) {
  const response = await business.owner.post('/products', {
    name: `Produk ${randomUUID().slice(0, 8)}`,
    unit: 'pcs',
    sell_price: 10_000,
    cost_price: 6_000,
    track_stock: true,
    opening_stock: 10,
    ...overrides,
  });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body;
}

export async function addContact(business, overrides = {}) {
  const response = await business.owner.post('/contacts', {
    name: `Kontak ${randomUUID().slice(0, 8)}`,
    type: 'both',
    ...overrides,
  });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body;
}

export function paidSale(business, items, overrides = {}) {
  return business.owner.post('/sales', {
    items,
    payment_type: 'paid',
    account_id: business.kas.id,
    ...overrides,
  });
}
