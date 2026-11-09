import { pool } from '../db/pool.js';
import * as reports from '../db/reports.js';
import { todayJakarta } from '../lib/dates.js';

/** The same formula as profit and loss, for today only. Stock purchases never reduce profit. */
export async function getDashboard(actor) {
  const today = todayJakarta();
  const businessId = actor.business_id;
  const [sales, other, expenses] = await Promise.all([
    reports.salesTotals(pool, businessId, today, today),
    reports.otherIncome(pool, businessId, today, today),
    reports.expensesByCategory(pool, businessId, today, today),
  ]);
  const counted = expenses.filter((row) => row.pl_group !== 'inventory');
  const expenseTotal = counted.reduce((sum, row) => sum + row.amount, 0);

  return {
    today,
    today_profit: sales.revenue - sales.cogs + other.amount - expenseTotal,
    is_empty: sales.sale_count === 0 && other.line_count === 0 && expenses.length === 0,
  };
}
