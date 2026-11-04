import { pool, withTx } from '../db/pool.js';
import { getBusiness } from '../db/business.js';
import { turnoverByMonth } from '../db/reports.js';
import { getSystemCategory } from '../db/categories.js';
import { insertTransaction } from '../db/transactions.js';
import { writeAudit } from '../db/audit.js';
import { unprocessable } from '../lib/errors.js';
import { basisPointsOf } from '../lib/money.js';
import { requireActiveAccount } from './accounts.js';

const MISSING_TAXPAYER = 'Lengkapi jenis wajib pajak di Pengaturan.';
const DISCLAIMER = 'Ini perkiraan. Konfirmasikan tarif dan ketentuan terbaru dengan konsultan pajak.';

/**
 * Twelve monthly lines from gross turnover. Individuals pay nothing on cumulative turnover up to
 * the threshold; companies have no threshold. Rate and threshold always come from settings.
 */
export function computeTaxMonths(turnoverPerMonth, { taxpayerType, rateBp, threshold }) {
  let cumulative = 0;
  let previousTaxable = 0;
  return turnoverPerMonth.map((turnover, index) => {
    cumulative += turnover;
    const taxableCumulative =
      taxpayerType === 'individual' ? Math.max(0, cumulative - threshold) : cumulative;
    const taxable = taxableCumulative - previousTaxable;
    previousTaxable = taxableCumulative;
    return {
      month: index + 1,
      turnover,
      cumulative,
      taxable,
      tax: basisPointsOf(taxable, rateBp),
    };
  });
}

export async function estimateTax(actor, year) {
  const business = await getBusiness(pool, actor.business_id);
  if (!business.taxpayer_type) throw unprocessable(MISSING_TAXPAYER, 'TAXPAYER_TYPE_MISSING');

  const rows = await turnoverByMonth(pool, actor.business_id, year);
  const turnover = Array.from(
    { length: 12 },
    (_, index) => rows.find((row) => row.month === index + 1)?.turnover ?? 0,
  );
  const months = computeTaxMonths(turnover, {
    taxpayerType: business.taxpayer_type,
    rateBp: business.tax_rate_bp,
    threshold: Number(business.tax_threshold),
  });
  return {
    year,
    taxpayer_type: business.taxpayer_type,
    tax_rate: business.tax_rate_bp / 100,
    tax_threshold: business.tax_threshold,
    months,
    total_turnover: months.reduce((sum, month) => sum + month.turnover, 0),
    total_tax: months.reduce((sum, month) => sum + month.tax, 0),
    disclaimer: DISCLAIMER,
  };
}

export async function recordTaxPayment(actor, body) {
  return withTx(async (client) => {
    await requireActiveAccount(client, actor.business_id, body.account_id);
    const category = await getSystemCategory(client, actor.business_id, 'tax');
    const id = await insertTransaction(client, {
      businessId: actor.business_id,
      account_id: body.account_id,
      type: 'expense',
      amount: body.amount,
      category_id: category.id,
      occurred_on: body.paid_on,
      note: `Pajak final ${String(body.month).padStart(2, '0')}/${body.year}`,
      created_by: actor.id,
    });
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'transaction',
      entityId: id,
      detail: { amount: body.amount, year: body.year, month: body.month },
    });
    return { transaction_id: id };
  });
}
