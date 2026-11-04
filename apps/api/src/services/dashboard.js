import { pool } from '../db/pool.js';
import * as reports from '../db/reports.js';
import { getBusiness } from '../db/business.js';
import { listAccounts } from '../db/accounts.js';
import { listTransactions } from '../db/transactions.js';
import { periodContaining, previousPeriod, todayJakarta } from '../lib/dates.js';

const LATEST_LIMIT = 10;

async function staffDashboard(actor, today) {
  const todaySales = await reports.salesOnDate(pool, actor.business_id, today);
  const latest = await listTransactions(pool, actor.business_id, {
    created_by: actor.id,
    page: 1,
    limit: LATEST_LIMIT,
  });
  return {
    role: 'staff',
    today,
    cards: { today_sales: todaySales.total, today_sale_count: todaySales.count },
    latest: latest.items,
  };
}

function sumPeriodFigures(sales, other, expenses) {
  const counted = expenses.filter((row) => row.pl_group !== 'inventory');
  const expenseTotal = counted.reduce((sum, row) => sum + row.amount, 0);
  return {
    period_revenue: sales.revenue,
    period_expenses: expenseTotal,
    estimated_net_profit: sales.revenue - sales.cogs + other.amount - expenseTotal,
    counted,
  };
}

export async function getDashboard(actor, periodChoice) {
  const today = todayJakarta();
  if (actor.role === 'staff') return staffDashboard(actor, today);

  const businessId = actor.business_id;
  const { period_start_day: startDay } = await getBusiness(pool, businessId);
  const current = periodContaining(today, startDay);
  const period = periodChoice === 'previous' ? previousPeriod(current, startDay) : current;

  const [sales, other, expenses, todaySales, accounts, debts, series, top, lowStock, latest] =
    await Promise.all([
      reports.salesTotals(pool, businessId, period.from, period.to),
      reports.otherIncome(pool, businessId, period.from, period.to),
      reports.expensesByCategory(pool, businessId, period.from, period.to),
      reports.salesOnDate(pool, businessId, today),
      listAccounts(pool, businessId, false),
      reports.debtSummary(pool, businessId, today),
      reports.dailySeries(pool, businessId, period.from, period.to),
      reports.topProducts(pool, businessId, period.from, period.to),
      reports.lowStockProducts(pool, businessId),
      listTransactions(pool, businessId, { page: 1, limit: LATEST_LIMIT }),
    ]);

  const figures = sumPeriodFigures(sales, other, expenses);
  return {
    role: actor.role,
    today,
    period,
    is_empty: sales.sale_count === 0 && latest.total === 0,
    cards: {
      today_sales: todaySales.total,
      today_sale_count: todaySales.count,
      period_revenue: figures.period_revenue,
      period_expenses: figures.period_expenses,
      estimated_net_profit: figures.estimated_net_profit,
      total_balance: accounts.reduce((sum, account) => sum + account.balance, 0),
      receivables: debts.receivables,
      payables: debts.payables,
      overdue_count: debts.overdue_count,
      overdue_receivables: debts.overdue_receivables,
      overdue_receivable_count: debts.overdue_receivable_count,
    },
    series,
    top_products: top,
    expense_breakdown: figures.counted,
    low_stock: lowStock,
    latest: latest.items,
  };
}
