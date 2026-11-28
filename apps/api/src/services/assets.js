import { pool, withTx } from '../db/pool.js';
import * as assets from '../db/assets.js';
import { getBusiness, updateOpening } from '../db/business.js';
import { getCategory } from '../db/categories.js';
import * as transactions from '../db/transactions.js';
import { requireActiveAccount } from './accounts.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { fieldError, notFound } from '../lib/errors.js';
import {
  accumulatedAmortization,
  amortizationBetween,
  bookValue,
  monthlyShare,
} from '../lib/amortization.js';
import { addDays, todayJakarta } from '../lib/dates.js';

/*
 * The register holds two kinds of assets. Ones acquired before the opening date are part of
 * the opening position: nothing pays for them inside usahaku. Ones acquired on or after it
 * are purchases: they are paid from a cash account through an expense transaction
 * (source_type 'asset'), which moves cash and shows in cash flow, while profit and loss only
 * sees the monthly depreciation. Without an opening date, the payment is optional.
 */

function monthOf(date) {
  const from = `${date.slice(0, 8)}01`;
  const nextMonth = `${addDays(from, 32).slice(0, 8)}01`;
  return { from, to: addDays(nextMonth, -1) };
}

function withSchedule(asset, asOf, openingDate) {
  const month = monthOf(asOf);
  return {
    ...asset,
    monthly_share: monthlyShare(asset),
    accumulated: accumulatedAmortization(asset, asOf, openingDate),
    book_value: bookValue(asset, asOf, openingDate),
    month_amortization: amortizationBetween(asset, month.from, month.to, openingDate),
  };
}

export async function listAssets(actor, asOf = todayJakarta()) {
  const [rows, business] = await Promise.all([
    assets.listAssets(pool, actor.business_id),
    getBusiness(pool, actor.business_id),
  ]);
  return {
    as_of: asOf,
    items: rows.map((asset) => withSchedule(asset, asOf, business.opening_date)),
  };
}

async function requireAmortizationCategory(client, businessId, categoryId) {
  const category = await getCategory(client, businessId, categoryId);
  if (
    !category ||
    category.is_archived ||
    category.type !== 'expense' ||
    category.pl_group === 'inventory' ||
    category.cash_activity !== 'operating'
  ) {
    throw fieldError(
      'expense_category_id',
      'Pilih kategori pengeluaran aktif untuk beban penyusutan atau amortisasi.',
    );
  }
}

function assertPaymentFits(business, body) {
  const paid = body.paid_from_account_id !== null;
  const opening = business.opening_date;
  if (opening && body.acquired_on < opening && paid) {
    throw fieldError(
      'paid_from_account_id',
      'Harta yang diperoleh sebelum tanggal saldo awal sudah termasuk saldo awal, jadi tidak dicatat sebagai pengeluaran.',
    );
  }
  if (opening && body.acquired_on >= opening && !paid) {
    throw fieldError(
      'paid_from_account_id',
      'Pilih akun yang dipakai membayar. Harta yang dibeli sejak tanggal saldo awal dicatat sebagai pengeluaran.',
    );
  }
  if (paid && !body.purchase_category_id) {
    throw fieldError('purchase_category_id', 'Pilih kategori pembelian.');
  }
}

async function requirePurchaseCategory(client, businessId, categoryId) {
  const category = await getCategory(client, businessId, categoryId);
  if (
    !category ||
    category.is_archived ||
    category.type !== 'expense' ||
    category.pl_group === 'inventory'
  ) {
    throw fieldError('purchase_category_id', 'Pilih kategori pengeluaran aktif untuk pembelian.');
  }
}

/*
 * Keeps the purchase transaction in step with the asset: created, updated, or removed. An
 * account or category left unchanged may since have been archived.
 */
async function syncPurchase(client, actor, assetId, body, before = null) {
  const existing = before?.purchase_transaction_id ?? null;
  const paid = body.paid_from_account_id !== null;
  if (!paid) {
    if (existing) await transactions.softDeleteTransaction(client, actor.business_id, existing);
    return;
  }
  if (body.paid_from_account_id !== before?.paid_from_account_id) {
    await requireActiveAccount(
      client,
      actor.business_id,
      body.paid_from_account_id,
      'paid_from_account_id',
    );
  }
  if (body.purchase_category_id !== before?.purchase_category_id) {
    await requirePurchaseCategory(client, actor.business_id, body.purchase_category_id);
  }
  const purchase = {
    type: 'expense',
    amount: body.cost,
    account_id: body.paid_from_account_id,
    transfer_account_id: null,
    category_id: body.purchase_category_id,
    contact_id: null,
    occurred_on: body.acquired_on,
    note: `Pembelian ${body.name}`,
    is_excluded: false,
  };
  if (existing) {
    await transactions.updateTransaction(client, actor.business_id, existing, purchase);
  } else {
    await transactions.insertTransaction(client, {
      ...purchase,
      businessId: actor.business_id,
      source_type: 'asset',
      source_id: assetId,
      created_by: actor.id,
    });
  }
}

const assetFields = (asset) => ({
  ...asset,
  paid_from_account_id: asset.paid_from_account_id ?? null,
  purchase_category_id: asset.paid_from_account_id ? asset.purchase_category_id : null,
});

/*
 * Editing changes every period the asset touches: its depreciation is recomputed from the
 * new figures, not posted entries. An unchanged category may since have been archived.
 */
export async function updateAsset(actor, assetId, input) {
  const body = assetFields(input);
  return withTx(async (client) => {
    const before = await assets.getAsset(client, actor.business_id, assetId);
    if (!before) throw notFound('Harta tidak ditemukan.');
    const business = await getBusiness(client, actor.business_id);
    assertPaymentFits(business, body);
    if (body.expense_category_id !== before.expense_category_id) {
      await requireAmortizationCategory(client, actor.business_id, body.expense_category_id);
    }
    await assets.updateAsset(client, actor.business_id, assetId, body);
    await syncPurchase(client, actor, assetId, body, before);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'asset',
      entityId: assetId,
      detail: changedFields(before, body),
    });
    const asset = await assets.getAsset(client, actor.business_id, assetId);
    return withSchedule(asset, todayJakarta(), business.opening_date);
  });
}

export async function createAsset(actor, input) {
  const body = assetFields(input);
  return withTx(async (client) => {
    const business = await getBusiness(client, actor.business_id);
    assertPaymentFits(business, body);
    await requireAmortizationCategory(client, actor.business_id, body.expense_category_id);
    const id = await assets.insertAsset(client, actor.business_id, body);
    await syncPurchase(client, actor, id, body);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'asset',
      entityId: id,
      detail: body,
    });
    const asset = await assets.getAsset(client, actor.business_id, id);
    return withSchedule(asset, todayJakarta(), business.opening_date);
  });
}

export async function deleteAsset(actor, assetId) {
  await withTx(async (client) => {
    const asset = await assets.getAsset(client, actor.business_id, assetId);
    if (!asset) throw notFound('Harta tidak ditemukan.');
    await transactions.softDeleteBySource(client, actor.business_id, 'asset', assetId);
    await assets.deleteAsset(client, actor.business_id, assetId);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'delete',
      entityType: 'asset',
      entityId: assetId,
      detail: { name: asset.name },
    });
  });
}

async function assertOpeningDateFits(client, businessId, openingDate) {
  const latest = await assets.latestAcquisition(client, businessId);
  if (latest && latest >= openingDate) {
    throw fieldError(
      'opening_date',
      'Tanggal saldo awal harus setelah tanggal perolehan semua harta di daftar harta.',
    );
  }
  const { rows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM transactions WHERE business_id = $1 AND deleted_at IS NULL
                      AND occurred_on < $2)
         OR EXISTS (SELECT 1 FROM sales WHERE business_id = $1 AND status = 'active'
                      AND sale_date < $2) AS has_earlier`,
    [businessId, openingDate],
  );
  if (rows[0].has_earlier) {
    throw fieldError(
      'opening_date',
      'Sudah ada transaksi sebelum tanggal ini. Saldo awal harus sebelum transaksi pertama.',
    );
  }
}

/** Opening date, owner capital, and the name shown on the capital line of the balance sheet. */
export async function setOpening(actor, body) {
  if (body.opening_capital !== null && !body.opening_date) {
    throw fieldError('opening_date', 'Isi tanggal saldo awal untuk modal awal.');
  }
  return withTx(async (client) => {
    const before = await getBusiness(client, actor.business_id);
    if (body.opening_date)
      await assertOpeningDateFits(client, actor.business_id, body.opening_date);
    const after = await updateOpening(client, actor.business_id, body);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'business',
      entityId: actor.business_id,
      detail: changedFields(before, body),
    });
    return after;
  });
}
