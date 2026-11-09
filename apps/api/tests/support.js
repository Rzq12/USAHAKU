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

export function paidSale(business, items, overrides = {}) {
  return business.owner.post('/sales', {
    items,
    account_id: business.kas.id,
    ...overrides,
  });
}

/*
 * Rows the retired receivables, contacts, and invoice features left behind.
 * They are written directly so tests can prove old records still behave.
 */
async function ownerRow(business) {
  const { rows } = await pool.query('SELECT id, business_id FROM users WHERE email = $1', [
    business.email,
  ]);
  return rows[0];
}

export async function insertLegacyContact(business, { name, type = 'both' }) {
  const { business_id } = await ownerRow(business);
  const { rows } = await pool.query(
    'INSERT INTO contacts (business_id, name, type) VALUES ($1, $2, $3) RETURNING id',
    [business_id, name, type],
  );
  return rows[0].id;
}

export async function insertLegacyCreditSale(
  business,
  { contactId, total, saleDate, dueDate, lineCost = 0 },
) {
  const owner = await ownerRow(business);
  const sale = await pool.query(
    `INSERT INTO sales (business_id, contact_id, sale_date, subtotal, total, payment_type, created_by)
     VALUES ($1, $2, $3, $4, $4, 'credit', $5) RETURNING id`,
    [owner.business_id, contactId, saleDate, total, owner.id],
  );
  const saleId = sale.rows[0].id;
  await pool.query(
    `INSERT INTO sale_items (business_id, sale_id, description, qty, unit_price, unit_cost,
       line_total, line_cost)
     VALUES ($1, $2, 'Barang lama', 1, $3, $4, $3, $4)`,
    [owner.business_id, saleId, total, lineCost],
  );
  const debt = await pool.query(
    `INSERT INTO debts (business_id, type, contact_id, source_type, source_id, issue_date, due_date,
       amount, created_by)
     VALUES ($1, 'receivable', $2, 'sale', $3, $4, $5, $6, $7) RETURNING id`,
    [owner.business_id, contactId, saleId, saleDate, dueDate, total, owner.id],
  );
  return { saleId, debtId: debt.rows[0].id };
}

export async function insertLegacyInvoice(business, { saleId, number, issueDate }) {
  const owner = await ownerRow(business);
  const { rows } = await pool.query(
    `INSERT INTO invoices (business_id, sale_id, number, issue_date, status, created_by)
     VALUES ($1, $2, $3, $4, 'issued', $5) RETURNING id`,
    [owner.business_id, saleId, number, issueDate, owner.id],
  );
  return rows[0].id;
}

export async function insertLegacyDebt(
  business,
  { type, contactId, amount, categoryId = null, issueDate, dueDate = issueDate },
) {
  const owner = await ownerRow(business);
  const { rows } = await pool.query(
    `INSERT INTO debts (business_id, type, contact_id, source_type, category_id, issue_date, due_date,
       amount, created_by)
     VALUES ($1, $2, $3, 'manual', $4, $5, $6, $7, $8) RETURNING id`,
    [owner.business_id, type, contactId, categoryId, issueDate, dueDate, amount, owner.id],
  );
  return rows[0].id;
}

export async function insertLegacyDebtPayment(business, { debtId, amount, accountId, paidOn }) {
  const owner = await ownerRow(business);
  const debt = (await pool.query('SELECT * FROM debts WHERE id = $1', [debtId])).rows[0];
  const isReceivable = debt.type === 'receivable';
  const salesCategory = await pool.query(
    `SELECT id FROM categories WHERE business_id = $1 AND system_key = 'sales'`,
    [owner.business_id],
  );
  const transaction = await pool.query(
    `INSERT INTO transactions (business_id, account_id, type, amount, category_id, contact_id,
       occurred_on, source_type, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      owner.business_id,
      accountId,
      isReceivable ? 'income' : 'expense',
      amount,
      isReceivable ? salesCategory.rows[0].id : debt.category_id,
      debt.contact_id,
      paidOn,
      isReceivable ? 'receivable_payment' : 'payable_payment',
      owner.id,
    ],
  );
  const transactionId = transaction.rows[0].id;
  const payment = await pool.query(
    `INSERT INTO debt_payments (business_id, debt_id, transaction_id, amount, paid_on, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [owner.business_id, debtId, transactionId, amount, paidOn, owner.id],
  );
  const paymentId = payment.rows[0].id;
  await pool.query('UPDATE transactions SET source_id = $1 WHERE id = $2', [
    paymentId,
    transactionId,
  ]);
  const paid = Number(debt.paid_amount) + amount;
  await pool.query('UPDATE debts SET paid_amount = $1, status = $2 WHERE id = $3', [
    paid,
    paid === Number(debt.amount) ? 'paid' : 'partial',
    debtId,
  ]);
  return paymentId;
}

/** A Staff or Accountant account from before the app had one role. */
export async function insertLegacyUser(business, role) {
  const { hashPassword } = await import('../src/services/auth.js');
  const { business_id } = await ownerRow(business);
  const email = uniqueEmail(role);
  const password = 'sandi-lama-123';
  const { rows } = await pool.query(
    `INSERT INTO users (business_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [business_id, `Pengguna ${role}`, email, await hashPassword(password), role],
  );
  return { id: rows[0].id, email, password };
}
