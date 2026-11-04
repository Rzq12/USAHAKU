import { pool, withTx } from '../db/pool.js';
import * as budgets from '../db/budgets.js';
import { getBusiness } from '../db/business.js';
import { writeAudit } from '../db/audit.js';
import { daysBetween, periodContaining, todayJakarta } from '../lib/dates.js';
import { requireActiveCategory } from './categories.js';

const NEAR_LIMIT_PERCENT = 80;
const OVER_LIMIT_PERCENT = 100;

function usageFigures(budget, used, daysLeft) {
  const remaining = budget - used;
  const percent = budget > 0 ? Math.floor((used * 100) / budget) : 0;
  let status = 'ok';
  if (percent >= OVER_LIMIT_PERCENT) status = 'over';
  else if (percent >= NEAR_LIMIT_PERCENT) status = 'near';
  return {
    budget,
    used,
    remaining,
    percent,
    status,
    remaining_per_day: daysLeft > 0 && remaining > 0 ? Math.floor(remaining / daysLeft) : 0,
  };
}

function daysLeftInPeriod(period, today) {
  if (today > period.to) return 0;
  if (today < period.from) return daysBetween(period.from, period.to) + 1;
  return daysBetween(today, period.to) + 1;
}

export async function budgetSummary(actor, date) {
  const { period_start_day: startDay } = await getBusiness(pool, actor.business_id);
  const today = todayJakarta();
  const period = periodContaining(date ?? today, startDay);
  const daysLeft = daysLeftInPeriod(period, today);
  const rows = await budgets.budgetUsage(pool, actor.business_id, period);

  const items = rows.map((row) => ({
    category_id: row.category_id,
    category_name: row.category_name,
    ...usageFigures(row.budget, row.used, daysLeft),
  }));
  const budgetTotal = rows.reduce((sum, row) => sum + row.budget, 0);
  const usedTotal = rows.reduce((sum, row) => sum + row.used, 0);
  return { period, days_left: daysLeft, items, totals: usageFigures(budgetTotal, usedTotal, daysLeft) };
}

export async function saveBudget(actor, body) {
  const { period_start_day: startDay } = await getBusiness(pool, actor.business_id);
  const period = periodContaining(body.period, startDay);
  await withTx(async (client) => {
    for (const item of body.items) {
      await requireActiveCategory(client, actor.business_id, item.category_id, 'expense');
    }
    const budgetId = await budgets.upsertBudget(client, actor.business_id, period.from);
    await budgets.replaceBudgetItems(client, actor.business_id, budgetId, body.items);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'budget',
      entityId: budgetId,
      detail: { period_start: period.from, items: body.items },
    });
  });
  return budgetSummary(actor, period.from);
}
