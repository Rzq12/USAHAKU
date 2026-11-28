/*
 * Moves a business kept in Zahir into usahaku from the class workbook exported next to it.
 *
 *   npm run import:zahir -w apps/api -- "<path to workbook.xlsx>"
 *
 * Reads only inputs: the opening position (sheet COA, the last two columns: saldo awal of the
 * journal month), the asset list (sheet Daftar-daftar), and the month's journal (sheet
 * Oktober). Everything goes in through the usahaku API, so the same validation applies as in
 * the app. Month-end adjusting entries (rent amortization, depreciation) and opening retained
 * earnings are NOT imported: usahaku computes them, and this script checks the result against
 * the workbook before finishing.
 *
 * The owner signs in with ZAHIR_OWNER_EMAIL / ZAHIR_OWNER_PASSWORD from .env; when they are
 * missing, the script makes them up and appends them to .env (which git ignores). To import
 * into an empty business someone already signed up for instead, set ZAHIR_INTO_EMAIL.
 */
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

process.env.LOG_REQUESTS = 'false';
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { addDays } = await import('../src/lib/dates.js');
const { hashToken, sessionExpiry, SESSION_COOKIE } = await import('../src/middleware/auth.js');
const { insertSession, deleteSessionByHash } = await import('../src/db/users.js');

const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
const MONTHS = [
  'januari',
  'februari',
  'maret',
  'april',
  'mei',
  'juni',
  'juli',
  'agustus',
  'september',
  'oktober',
  'november',
  'desember',
];

/* ---------- Reading the workbook ---------- */

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return value.result;
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
  }
  return typeof value === 'string' ? value.replace(/\u00a0/g, ' ').trim() || null : value;
}

function rowsOf(workbook, name) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Sheet "${name}" tidak ada di workbook.`);
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      values.push(cellValue(row.getCell(column)));
    }
    rows.push(values);
  });
  return rows;
}

const isoDate = (date) => date.toISOString().slice(0, 10);
const rupiah = (value) => Math.round(Number(value ?? 0));

/** "Neraca Saldo Awal Juli 2026" → the first day of that month, when the assets were bought. */
function acquisitionDate(workbook) {
  for (const value of rowsOf(workbook, 'Perhitungan Saldo Awal').flat()) {
    const match = typeof value === 'string' && value.match(/Saldo Awal (\w+) (\d{4})/i);
    const month = match ? MONTHS.indexOf(match[1].toLowerCase()) + 1 : 0;
    if (month > 0) return `${match[2]}-${String(month).padStart(2, '0')}-01`;
  }
  throw new Error('Judul "Neraca Saldo Awal <bulan> <tahun>" tidak ditemukan.');
}

/** Equipment rows until "Total", and the yearly rent paid up front. */
function assetList(workbook) {
  const rows = rowsOf(workbook, 'Daftar-daftar');
  const header = rows.findIndex((row) => row[0] === 'Nama Peralatan');
  const rentHeader = rows.findIndex((row) => row[0] === 'Biaya Sewa Pertahun');
  if (header < 0 || rentHeader < 0) throw new Error('Daftar peralatan atau sewa tidak ditemukan.');
  const equipment = [];
  for (const row of rows.slice(header + 1)) {
    if (!row[0] || row[0] === 'Total') break;
    const [name, unitCost, units, , years] = row;
    equipment.push({
      name: `${name} (${units} unit)`,
      cost: rupiah(unitCost) * Number(units),
      useful_life_months: Number(years) * 12,
    });
  }
  return { equipment, yearlyRent: rupiah(rows[rentHeader + 1][0]) };
}

/** Chart of accounts with the opening balance of the journal month (the last two columns). */
function chartOfAccounts(workbook) {
  const rows = rowsOf(workbook, 'COA');
  const header = rows.findIndex((row) => row[0] === 'KODE AKUN');
  const accounts = [];
  for (const row of rows.slice(header + 2)) {
    if (row[0] === 'Total' || row[0] === null) break;
    accounts.push({ code: String(row[0]), name: row[1], debit: row[5], credit: row[6] });
  }
  return { businessName: rows[0][0], accounts };
}

/** Journal entries: a dated row opens an entry, the rows under it are its lines. */
function journal(workbook, sheetName) {
  const entries = [];
  for (const [date, description, account, , debit, credit] of rowsOf(workbook, sheetName)) {
    if (/^total$/i.test(account ?? '') || /^total$/i.test(description ?? '')) break;
    if (date instanceof Date) entries.push({ date: isoDate(date), description, lines: [] });
    const entry = entries.at(-1);
    if (entry && account && (debit || credit)) {
      entry.lines.push({ account, debit: rupiah(debit), credit: rupiah(credit) });
    }
  }
  return entries;
}

/* ---------- Talking to usahaku ---------- */

function apiClient(baseUrl) {
  let cookie = '';
  const api = async (method, url, json) => {
    const response = await fetch(`${baseUrl}/api${url}`, {
      method,
      headers: {
        'X-Usahaku-Client': 'web',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      throw new Error(`${method} ${url} → ${response.status} ${JSON.stringify(body)}`);
    }
    return body;
  };
  api.useSession = (token) => {
    cookie = `${SESSION_COOKIE}=${token}`;
  };
  return api;
}

/*
 * ZAHIR_INTO_EMAIL imports into the business of a user who already signed up, without their
 * password: the script opens a session for them straight in the database (it has database
 * access anyway) and closes it when done. It only imports into a business that is still empty.
 */
async function existingOwner(email, api) {
  const { rows } = await pool.query(
    `SELECT u.id, u.business_id,
       EXISTS (SELECT 1 FROM transactions t WHERE t.business_id = u.business_id)
         OR EXISTS (SELECT 1 FROM sales s WHERE s.business_id = u.business_id)
         OR EXISTS (SELECT 1 FROM assets a WHERE a.business_id = u.business_id)
         OR b.opening_date IS NOT NULL AS has_data
     FROM users u JOIN businesses b ON b.id = u.business_id WHERE lower(u.email) = lower($1)`,
    [email],
  );
  if (!rows[0]) throw new Error(`Tidak ada pengguna dengan email ${email}.`);
  const token = randomBytes(32).toString('hex');
  await insertSession(pool, rows[0].id, hashToken(token), sessionExpiry());
  closeSession = () => deleteSessionByHash(pool, hashToken(token));
  api.useSession(token);
  return { email, existing: true, hasData: rows[0].has_data, created: false };
}

let closeSession = async () => {};

async function ownerCredentials() {
  const email = process.env.ZAHIR_OWNER_EMAIL || 'anno@usahaku.test';
  if (process.env.ZAHIR_OWNER_PASSWORD) {
    return { email, password: process.env.ZAHIR_OWNER_PASSWORD, created: false };
  }
  const password = randomBytes(12).toString('base64url');
  await appendFile(
    ENV_FILE,
    `\n# Owner of the business imported from Zahir (apps/api/scripts/import-zahir.js)\n` +
      `ZAHIR_OWNER_EMAIL=${email}\nZAHIR_OWNER_PASSWORD=${password}\n`,
  );
  return { email, password, created: true };
}

/* Zahir's groups: depreciation is a non-operating expense, the rest is general and admin. */
const plGroupOf = (name) => (/penyusutan/i.test(name) ? 'other_expense' : 'operating_expense');
const parentOf = (name) =>
  /penyusutan/i.test(name) ? 'Beban Penyusutan' : 'Beban Administrasi Dan Umum';

async function createExpenseCategories(api, accounts) {
  const ids = new Map();
  for (const account of accounts.filter((row) => /^Beban /i.test(row.name))) {
    const parentName = parentOf(account.name);
    if (!ids.has(parentName)) {
      const parent = await api('POST', '/categories', {
        name: parentName,
        type: 'expense',
        pl_group: plGroupOf(account.name),
      });
      ids.set(parentName, parent.id);
    }
    const category = await api('POST', '/categories', {
      name: account.name,
      type: 'expense',
      parent_id: ids.get(parentName),
      pl_group: plGroupOf(account.name),
    });
    ids.set(account.name, category.id);
  }
  return (name) => {
    if (!ids.has(name)) throw new Error(`Kategori "${name}" tidak ada di COA.`);
    return ids.get(name);
  };
}

/*
 * The workbook's Beban accounts replace usahaku's default operating expense categories (Sewa,
 * Listrik dan Utilitas, Gaji, ...), so the list matches the COA. A default that was used
 * anyway is archived instead of deleted; system categories stay.
 */
async function dropDefaultExpenseCategories(api) {
  const { items } = await api('GET', '/categories');
  const defaults = items.filter(
    (row) =>
      row.type === 'expense' &&
      row.pl_group === 'operating_expense' &&
      !row.system_key &&
      !row.parent_id &&
      !/^Beban /i.test(row.name),
  );
  for (const category of defaults) {
    if (Number(category.usage_count) === 0) {
      try {
        await api('DELETE', `/categories/${category.id}`);
        continue;
      } catch (error) {
        if (!/ 409 /.test(error.message)) throw error;
      }
    }
    await api('PUT', `/categories/${category.id}`, { is_archived: true });
  }
  return defaults.length;
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function importWorkbook(file, api) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const acquiredOn = acquisitionDate(workbook);
  const { equipment, yearlyRent } = assetList(workbook);
  const { businessName, accounts } = chartOfAccounts(workbook);
  const entries = journal(workbook, 'Oktober');
  const openingDate = `${entries[0].date.slice(0, 8)}01`;
  const account = (pattern) => {
    const found = accounts.find((row) => pattern.test(row.name));
    if (!found) throw new Error(`Akun ${pattern} tidak ada di COA.`);
    return found;
  };
  const cash = account(/^Kas$/i);
  const capital = account(/^Modal /i);
  const revenue = account(/^Pendapatan/i);

  const isCash = (line) => line.account === cash.name;
  const adjustments = entries
    .filter((entry) => !entry.lines.some(isCash))
    .flatMap((entry) => entry.lines.filter((line) => line.debit));
  const owner = process.env.ZAHIR_INTO_EMAIL
    ? await existingOwner(process.env.ZAHIR_INTO_EMAIL, api)
    : await ownerCredentials();
  const alreadyImported = owner.existing
    ? owner.hasData
    : await api('POST', '/auth/login', owner).then(
        () => true,
        () => false,
      );
  if (alreadyImported) {
    console.log(`${owner.email} sudah berisi data: tidak mengimpor ulang, hanya memeriksa hasil.`);
    const dropped = await dropDefaultExpenseCategories(api);
    if (dropped > 0) console.log(`${dropped} kategori beban bawaan dirapikan sesuai COA.`);
    return { owner, openingDate, saleCount: 0, expenseCount: 0, adjustments, accounts };
  }
  if (!owner.existing) {
    await api('POST', '/auth/register', {
      business_name: businessName,
      name: capital.name.replace(/^Modal\s+/i, ''),
      email: owner.email,
      password: owner.password,
    });
  }

  // Opening position on the first day of the journal month.
  const kas = (await api('GET', '/accounts')).items.find((row) => row.name === 'Kas');
  await api('PUT', `/accounts/${kas.id}`, {
    name: cash.name,
    type: 'cash',
    opening_balance: rupiah(cash.debit),
  });
  await api('PUT', '/business/opening', {
    opening_date: openingDate,
    opening_capital: rupiah(capital.credit),
    capital_name: capital.name,
  });

  // Revenue keeps Zahir's account name; expense accounts sit under Zahir's groups.
  const sales = (await api('GET', '/categories')).items.find((row) => row.system_key === 'sales');
  await api('PUT', `/categories/${sales.id}`, { name: revenue.name });
  const categoryId = await createExpenseCategories(api, accounts);
  await dropDefaultExpenseCategories(api);

  // Asset register: what the business owned before the opening date.
  await api('POST', '/assets', {
    kind: 'prepaid',
    group_name: account(/dibayar dimuka/i).name,
    name: 'Sewa tempat 1 tahun',
    acquired_on: acquiredOn,
    cost: yearlyRent,
    useful_life_months: 12,
    expense_category_id: categoryId('Beban Sewa'),
  });
  for (const item of equipment) {
    await api('POST', '/assets', {
      kind: 'fixed',
      group_name: account(/^Peralatan$/i).name,
      ...item,
      acquired_on: acquiredOn,
      expense_category_id: categoryId('Beban Penyusutan Peralatan'),
    });
  }

  // The month's journal: cash receipts become sales, cash payments become expenses,
  // and entries without cash are adjusting entries usahaku computes itself.
  const receipts = entries.filter((entry) =>
    entry.lines.some((line) => isCash(line) && line.debit),
  );
  const product = await api('POST', '/products', {
    name: 'Jasa Pangkas Rambut',
    unit: 'orang',
    sell_price: mostCommon(receipts.map((entry) => entry.lines.find(isCash).debit)),
    cost_price: 0,
    track_stock: false,
    opening_stock: 0,
  });
  let saleCount = 0;
  let expenseCount = 0;
  for (const entry of entries) {
    const cashLine = entry.lines.find(isCash);
    const other = entry.lines.filter((line) => !isCash(line));
    const unknown = new Error(`Jurnal ${entry.date} "${entry.description}" tidak dikenali.`);
    if (!cashLine) {
      continue;
    } else if (other.length !== 1) {
      throw unknown;
    } else if (cashLine.debit && other[0].account === revenue.name) {
      await api('POST', '/sales', {
        sale_date: entry.date,
        account_id: kas.id,
        items: [{ product_id: product.id, qty: 1, unit_price: cashLine.debit }],
      });
      saleCount += 1;
    } else if (cashLine.credit && /^Beban /i.test(other[0].account)) {
      await api('POST', '/transactions', {
        type: 'expense',
        account_id: kas.id,
        category_id: categoryId(other[0].account),
        amount: cashLine.credit,
        occurred_on: entry.date,
        note: entry.description,
      });
      expenseCount += 1;
    } else {
      throw unknown;
    }
  }
  return { owner, openingDate, saleCount, expenseCount, adjustments, accounts };
}

/* ---------- Checking usahaku's result against the workbook ---------- */

function check(label, computed, expected, failures) {
  const same = computed === expected;
  const show = (value) => value.toLocaleString('id-ID');
  console.log(
    `  ${same ? 'OK  ' : 'BEDA'} ${label}: ${show(computed)}` +
      (same ? '' : ` (workbook ${show(expected)})`),
  );
  if (!same) failures.push(label);
}

async function verify(api, result) {
  const from = result.openingDate;
  const to = addDays(`${addDays(from, 32).slice(0, 8)}01`, -1);
  const range = `from=${from}&to=${to}`;
  const pl = await api('GET', `/reports/profit-loss?${range}`);
  const balance = await api('GET', `/reports/balance-sheet?${range}`);
  const opening = await api('GET', `/assets?as_of=${addDays(from, -1)}`);
  const amount = (label) => pl.rows.find((row) => row.label === label)?.amount ?? 0;
  const account = (pattern) => result.accounts.find((row) => pattern.test(row.name));
  const register = (kind, key) =>
    opening.items.filter((item) => item.kind === kind).reduce((sum, item) => sum + item[key], 0);
  const failures = [];

  console.log('Penyesuaian akhir bulan, dihitung usahaku vs jurnal penyesuaian di workbook:');
  for (const line of result.adjustments) {
    check(line.account, amount(line.account), line.debit, failures);
  }
  console.log('Saldo awal, dihitung usahaku vs COA:');
  check(
    'Sewa dibayar dimuka',
    register('prepaid', 'book_value'),
    rupiah(account(/dibayar dimuka/i).debit),
    failures,
  );
  check(
    'Akumulasi penyusutan',
    register('fixed', 'accumulated'),
    rupiah(account(/^Akum/i).credit),
    failures,
  );
  check(
    'Saldo laba',
    balance.totals.retained_earnings,
    rupiah(account(/^Saldo Laba/i).credit),
    failures,
  );
  if (balance.totals.adjustment !== 0) failures.push('neraca tidak seimbang');
  return { failures, to, pl, balance };
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Pakai: npm run import:zahir -w apps/api -- "<workbook.xlsx>"');
  await migrate();
  const server = await new Promise((resolve) => {
    const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const api = apiClient(`http://127.0.0.1:${server.address().port}`);
    const result = await importWorkbook(path.resolve(file), api);
    console.log(
      `Diimpor: ${result.saleCount} penjualan, ${result.expenseCount} pengeluaran, ` +
        `saldo awal per ${result.openingDate}. Pemilik: ${result.owner.email}` +
        (result.owner.created ? ' (kata sandi ditambahkan ke .env)' : ''),
    );
    const { failures, to, pl, balance } = await verify(api, result);
    console.log(
      `Sampai ${to}: laba bersih ${pl.totals.net_profit.toLocaleString('id-ID')}, ` +
        `total harta ${balance.totals.total_assets.toLocaleString('id-ID')}, ` +
        `total kewajiban dan modal ${balance.totals.total_liabilities_and_equity.toLocaleString('id-ID')}.`,
    );
    if (failures.length > 0) {
      console.error(`Tidak cocok dengan workbook: ${failures.join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await closeSession();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

await main();
