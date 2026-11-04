import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { pool, withTx } from '../db/pool.js';
import { existingSignatures } from '../db/imports.js';
import { listCategories } from '../db/categories.js';
import { insertTransaction } from '../db/transactions.js';
import { writeAudit } from '../db/audit.js';
import { AppError, fieldError } from '../lib/errors.js';
import { parseCsv } from '../lib/csv.js';
import { isValidDate } from '../lib/dates.js';
import { MAX_AMOUNT } from '../lib/schemas.js';
import { requireActiveAccount } from './accounts.js';
import { requireActiveCategory } from './categories.js';

const MAX_ROWS = 5000;
const SAMPLE_ROWS = 20;
const TOO_MANY_ROWS = 'File melebihi 5.000 baris.';
const UNREADABLE = 'File tidak dapat dibaca. Gunakan CSV atau XLSX.';

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellToString(value.result);
    if ('text' in value) return String(value.text);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
  }
  return String(value);
}

async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheet');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      cells.push(cellToString(row.getCell(column).value));
    }
    rows.push(cells);
  });
  return rows;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

async function readTable(file) {
  if (!file) throw fieldError('file', 'Pilih file CSV atau XLSX.');
  let rows;
  try {
    rows = file.buffer.subarray(0, 4).equals(ZIP_MAGIC)
      ? await readXlsx(file.buffer)
      : parseCsv(file.buffer.toString('utf8'));
  } catch {
    throw new AppError(400, 'UNREADABLE_FILE', UNREADABLE);
  }
  if (rows.length < 2) throw new AppError(400, 'UNREADABLE_FILE', 'File tidak berisi baris data.');
  const [headers, ...data] = rows;
  if (data.length > MAX_ROWS) throw new AppError(400, 'TOO_MANY_ROWS', TOO_MANY_ROWS);
  return { headers: headers.map((header) => header.trim()), data };
}

/** Accepts 2026-11-04, 04/11/2026 and 04-11-2026. */
export function parseImportDate(raw) {
  const value = raw.trim();
  if (isValidDate(value)) return value;
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const iso = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

/** Whole rupiah only (BR-001): 1.250.000, 1,250,000, Rp1.250.000, -5000 and (5000) are accepted. */
export function parseImportAmount(raw) {
  let value = raw.trim().replace(/rp\.?/i, '').replace(/\s/g, '');
  const parenthesized = /^\(.*\)$/.test(value);
  if (parenthesized) value = value.slice(1, -1);
  const negative = value.startsWith('-') || parenthesized;
  value = value.replace(/^[-+]/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(value)) value = value.replace(/[.,]/g, '');
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  if (amount === 0 || amount > MAX_AMOUNT) return null;
  return negative ? -amount : amount;
}

const TYPE_WORDS = {
  income: 'income',
  pemasukan: 'income',
  masuk: 'income',
  debit: 'income',
  expense: 'expense',
  pengeluaran: 'expense',
  keluar: 'expense',
  kredit: 'expense',
};

function rowType(typeCell, amount) {
  if (typeCell === undefined) return amount < 0 ? 'expense' : 'income';
  return TYPE_WORDS[typeCell.trim().toLowerCase()] ?? null;
}

function signature(date, amount, note) {
  return `${date}|${amount}|${note}`;
}

function importHash(accountId, date, amount, note) {
  return createHash('sha256')
    .update(`${accountId}|${signature(date, amount, note)}`)
    .digest('hex');
}

function parseRow(cells, mapping, defaults, categoriesByName) {
  const column = (name) => (mapping[name] === undefined ? undefined : (cells[mapping[name]] ?? ''));
  const date = parseImportDate(column('date') ?? '');
  if (!date) return { status: 'invalid', reason: 'Tanggal tidak dikenali.' };
  const signedAmount = parseImportAmount(column('amount') ?? '');
  if (signedAmount === null) return { status: 'invalid', reason: 'Nominal tidak valid.' };
  const type = rowType(column('type'), signedAmount);
  if (!type) return { status: 'invalid', reason: 'Jenis tidak dikenali.' };

  const named = categoriesByName.get(`${type}|${(column('category') ?? '').trim().toLowerCase()}`);
  const categoryId = named ?? defaults[type];
  if (!categoryId) {
    return {
      status: 'invalid',
      reason: `Belum ada kategori bawaan untuk ${type === 'income' ? 'pemasukan' : 'pengeluaran'}.`,
    };
  }
  return {
    status: 'valid',
    occurred_on: date,
    amount: Math.abs(signedAmount),
    type,
    note: (column('note') ?? '').trim().slice(0, 500),
    category_id: categoryId,
  };
}

async function loadDefaults(client, actor, body) {
  await requireActiveAccount(client, actor.business_id, body.account_id);
  const categories = await listCategories(client, actor.business_id, false);
  const categoriesByName = new Map(
    categories.map((category) => [`${category.type}|${category.name.toLowerCase()}`, category.id]),
  );
  const defaults = {};
  const primary = categories.find((category) => category.id === body.default_category_id);
  if (!primary) throw fieldError('default_category_id', 'Pilih kategori bawaan yang aktif.');
  defaults[primary.type] = primary.id;
  if (body.default_income_category_id) {
    await requireActiveCategory(
      client,
      actor.business_id,
      body.default_income_category_id,
      'income',
    );
    defaults.income = body.default_income_category_id;
  }
  return { defaults, categoriesByName };
}

async function classifyRows(client, actor, body, data) {
  const { defaults, categoriesByName } = await loadDefaults(client, actor, body);
  const rows = data.map((cells, index) => ({
    row: index + 2,
    ...parseRow(cells, body.mapping, defaults, categoriesByName),
  }));

  const dates = rows
    .filter((row) => row.status === 'valid')
    .map((row) => row.occurred_on)
    .sort();
  const seen = new Set();
  if (dates.length > 0) {
    const existing = await existingSignatures(
      client,
      actor.business_id,
      body.account_id,
      dates[0],
      dates[dates.length - 1],
    );
    for (const row of existing) seen.add(signature(row.occurred_on, row.amount, row.note));
  }
  for (const row of rows) {
    if (row.status !== 'valid') continue;
    const key = signature(row.occurred_on, row.amount, row.note);
    if (seen.has(key)) {
      row.status = 'duplicate';
      row.reason = 'Sudah ada transaksi yang sama.';
    } else {
      seen.add(key);
    }
  }
  return rows;
}

function countByStatus(rows) {
  const counts = { valid: 0, invalid: 0, duplicate: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export async function previewImport(actor, file, body) {
  const { headers, data } = await readTable(file);
  const result = { headers, sample: data.slice(0, SAMPLE_ROWS), row_count: data.length };
  if (!body.mapping) return result;
  const rows = await classifyRows(pool, actor, body, data);
  return { ...result, preview: rows, counts: countByStatus(rows) };
}

export async function commitImport(actor, file, body) {
  const { data } = await readTable(file);
  return withTx(async (client) => {
    const rows = await classifyRows(client, actor, body, data);
    const accepted = rows.filter(
      (row) => row.status === 'valid' || (row.status === 'duplicate' && body.include_duplicates),
    );
    for (const row of accepted) {
      await insertTransaction(client, {
        businessId: actor.business_id,
        account_id: body.account_id,
        type: row.type,
        amount: row.amount,
        category_id: row.category_id,
        occurred_on: row.occurred_on,
        note: row.note || null,
        source_type: 'import',
        import_hash:
          row.status === 'valid'
            ? importHash(body.account_id, row.occurred_on, row.amount, row.note)
            : null,
        created_by: actor.id,
      });
    }
    const counts = countByStatus(rows);
    const summary = {
      imported: accepted.length,
      skipped: rows.length - accepted.length - counts.invalid,
      failed: counts.invalid,
    };
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'import',
      detail: { ...summary, filename: file.originalname },
    });
    return {
      summary,
      failed_rows: rows.filter((row) => row.status === 'invalid'),
      message: `${summary.imported} transaksi diimpor, ${summary.skipped + summary.failed} dilewati.`,
    };
  });
}
