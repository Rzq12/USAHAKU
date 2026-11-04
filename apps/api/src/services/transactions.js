import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, withTx } from '../db/pool.js';
import * as transactions from '../db/transactions.js';
import { getAccountBalance } from '../db/accounts.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { config } from '../config.js';
import { conflict, fieldError, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { requireActiveAccount } from './accounts.js';
import { requireActiveCategory } from './categories.js';

const SAME_ACCOUNT = 'Akun asal dan tujuan harus berbeda.';
const EDIT_WINDOW_OVER = 'Transaksi ini sudah tidak bisa diubah. Hubungi pemilik.';
const SYSTEM_SOURCE =
  'Transaksi ini dibuat otomatis. Ubah nominal, akun, atau tanggalnya dari catatan asalnya.';
const NO_DELETE_SOURCE = 'Transaksi ini dibuat dari penjualan atau pembayaran. Batalkan dari sana.';
const STAFF_ROLE = 'staff';

function normalizeTags(tags) {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

async function validateLinks(client, businessId, body) {
  await requireActiveAccount(client, businessId, body.account_id);
  if (body.type === 'transfer') {
    if (!body.transfer_account_id) {
      throw fieldError('transfer_account_id', 'Pilih akun tujuan.');
    }
    if (body.transfer_account_id === body.account_id) {
      throw fieldError('transfer_account_id', SAME_ACCOUNT);
    }
    await requireActiveAccount(client, businessId, body.transfer_account_id, 'transfer_account_id');
    return;
  }
  if (!body.category_id) throw fieldError('category_id', 'Pilih kategori.');
  await requireActiveCategory(client, businessId, body.category_id, body.type);
}

async function withBalance(client, actor, transactionId, accountId) {
  const transaction = await transactions.getTransaction(client, actor.business_id, transactionId);
  if (actor.role === STAFF_ROLE) return { transaction };
  return {
    transaction,
    account_balance: await getAccountBalance(client, actor.business_id, accountId),
  };
}

export async function createTransaction(actor, body) {
  return withTx(async (client) => {
    await validateLinks(client, actor.business_id, body);
    const id = await transactions.insertTransaction(client, {
      ...body,
      businessId: actor.business_id,
      transfer_account_id: body.type === 'transfer' ? body.transfer_account_id : null,
      category_id: body.type === 'transfer' ? null : body.category_id,
      created_by: actor.id,
    });
    await transactions.replaceTags(client, actor.business_id, id, normalizeTags(body.tags));
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'transaction',
      entityId: id,
      detail: { type: body.type, amount: body.amount, occurred_on: body.occurred_on },
    });
    return withBalance(client, actor, id, body.account_id);
  });
}

export async function listTransactions(actor, filters) {
  const scoped = actor.role === STAFF_ROLE ? { ...filters, created_by: actor.id } : filters;
  return transactions.listTransactions(pool, actor.business_id, scoped);
}

async function requireVisible(q, actor, transactionId) {
  const transaction = await transactions.getTransaction(q, actor.business_id, transactionId);
  if (!transaction) throw notFound('Transaksi tidak ditemukan.');
  if (actor.role === STAFF_ROLE && transaction.created_by !== actor.id) {
    throw notFound('Transaksi tidak ditemukan.');
  }
  return transaction;
}

export const getTransaction = (actor, transactionId) => requireVisible(pool, actor, transactionId);

/** BR-013: Staff may edit only their own entries, within 24 hours of creation. */
async function assertCanEdit(client, actor, transaction) {
  if (actor.role !== STAFF_ROLE) return;
  const within = await transactions.isWithinEditWindow(client, actor.business_id, transaction.id);
  if (transaction.created_by !== actor.id || !within) throw forbidden(EDIT_WINDOW_OVER);
}

export async function updateTransaction(actor, transactionId, body) {
  return withTx(async (client) => {
    const before = await requireVisible(client, actor, transactionId);
    await assertCanEdit(client, actor, before);

    const next = {
      type: before.type,
      amount: body.amount,
      account_id: body.account_id,
      transfer_account_id: before.type === 'transfer' ? body.transfer_account_id : null,
      category_id: before.type === 'transfer' ? null : body.category_id,
      contact_id: body.contact_id,
      occurred_on: body.occurred_on,
      note: body.note,
      is_excluded: body.is_excluded ?? before.is_excluded,
    };

    if (before.source_type !== 'manual') {
      const money = next.amount !== before.amount || next.account_id !== before.account_id;
      if (money || next.occurred_on !== before.occurred_on) {
        throw unprocessable(SYSTEM_SOURCE, 'SYSTEM_TRANSACTION');
      }
    } else {
      await validateLinks(client, actor.business_id, next);
    }

    await transactions.updateTransaction(client, actor.business_id, transactionId, next);
    await transactions.replaceTags(
      client,
      actor.business_id,
      transactionId,
      normalizeTags(body.tags),
    );
    const compared = { ...next };
    delete compared.type;
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'transaction',
      entityId: transactionId,
      detail: changedFields(before, { ...compared, tags: normalizeTags(body.tags).sort() }),
    });
    return withBalance(client, actor, transactionId, next.account_id);
  });
}

export async function deleteTransaction(actor, transactionId) {
  await withTx(async (client) => {
    const transaction = await requireVisible(client, actor, transactionId);
    if (['sale', 'receivable_payment', 'payable_payment'].includes(transaction.source_type)) {
      throw conflict(NO_DELETE_SOURCE, 'SYSTEM_TRANSACTION');
    }
    await transactions.softDeleteTransaction(client, actor.business_id, transactionId);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'delete',
      entityType: 'transaction',
      entityId: transactionId,
      detail: { amount: transaction.amount, occurred_on: transaction.occurred_on },
    });
  });
}

const IMAGE_SIGNATURES = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    matches: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** Checks the real file type from its bytes, not the name or declared type. */
export function detectImageType(buffer) {
  return IMAGE_SIGNATURES.find((signature) => signature.matches(buffer));
}

export async function attachReceipt(actor, transactionId, file) {
  if (!file) throw fieldError('receipt', 'Pilih foto struk.');
  const imageType = detectImageType(file.buffer);
  if (!imageType) throw fieldError('receipt', 'Foto harus berformat JPEG, PNG, atau WebP.');

  const transaction = await requireVisible(pool, actor, transactionId);
  await assertCanEdit(pool, actor, transaction);

  const relativePath = path.join(
    actor.business_id,
    `${randomBytes(16).toString('hex')}.${imageType.ext}`,
  );
  const absolutePath = path.join(config.uploadDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.buffer);

  await withTx(async (client) => {
    const attachmentId = await transactions.insertAttachment(client, actor.business_id, {
      file_path: relativePath,
      mime_type: imageType.mime,
      size_bytes: file.size,
    });
    await transactions.setAttachment(client, actor.business_id, transactionId, attachmentId);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'transaction',
      entityId: transactionId,
      detail: { receipt: { new: attachmentId } },
    });
  });
  return requireVisible(pool, actor, transactionId);
}

export async function getReceipt(actor, transactionId) {
  const transaction = await requireVisible(pool, actor, transactionId);
  if (!transaction.attachment_id) throw notFound('Transaksi ini belum punya foto.');
  const attachment = await transactions.getAttachment(
    pool,
    actor.business_id,
    transaction.attachment_id,
  );
  return {
    absolutePath: path.resolve(config.uploadDir, attachment.file_path),
    mimeType: attachment.mime_type,
  };
}
