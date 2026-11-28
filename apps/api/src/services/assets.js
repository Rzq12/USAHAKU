import { pool, withTx } from '../db/pool.js';
import * as assets from '../db/assets.js';
import { getBusiness, updateOpening } from '../db/business.js';
import { getCategory } from '../db/categories.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { fieldError, notFound } from '../lib/errors.js';
import { accumulatedAmortization, amortizationBetween, bookValue } from '../lib/amortization.js';
import { addDays, todayJakarta } from '../lib/dates.js';

/*
 * The register holds what the business already owned when usahaku took over the books, so
 * its value is part of the opening position. With an opening date set, an asset must be
 * acquired before it; otherwise nothing would fund it and the balance sheet would not close.
 */

function monthOf(date) {
  const from = `${date.slice(0, 8)}01`;
  const nextMonth = `${addDays(from, 32).slice(0, 8)}01`;
  return { from, to: addDays(nextMonth, -1) };
}

function withSchedule(asset, asOf) {
  const month = monthOf(asOf);
  return {
    ...asset,
    accumulated: accumulatedAmortization(asset, asOf),
    book_value: bookValue(asset, asOf),
    month_amortization: amortizationBetween(asset, month.from, month.to),
  };
}

export async function listAssets(actor, asOf = todayJakarta()) {
  const rows = await assets.listAssets(pool, actor.business_id);
  return { as_of: asOf, items: rows.map((asset) => withSchedule(asset, asOf)) };
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

export async function createAsset(actor, body) {
  return withTx(async (client) => {
    const business = await getBusiness(client, actor.business_id);
    if (business.opening_date && body.acquired_on >= business.opening_date) {
      throw fieldError(
        'acquired_on',
        'Tanggal perolehan harus sebelum tanggal saldo awal, karena harta ini bagian dari saldo awal.',
      );
    }
    await requireAmortizationCategory(client, actor.business_id, body.expense_category_id);
    const id = await assets.insertAsset(client, actor.business_id, body);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'asset',
      entityId: id,
      detail: body,
    });
    return withSchedule(await assets.getAsset(client, actor.business_id, id), todayJakarta());
  });
}

export async function deleteAsset(actor, assetId) {
  await withTx(async (client) => {
    const asset = await assets.getAsset(client, actor.business_id, assetId);
    if (!asset) throw notFound('Harta tidak ditemukan.');
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
