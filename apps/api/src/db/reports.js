/*
 * Reports read from here. Revenue comes from sales, never from income transactions linked to sales.
 * Transfers and debt payments never reach profit and loss (BR-002, BR-008).
 */

const EXPENSE_LINES = `
  SELECT t.category_id, t.occurred_on AS on_date, t.amount
  FROM transactions t
  WHERE t.business_id = $1 AND t.type = 'expense' AND t.deleted_at IS NULL AND NOT t.is_excluded
    AND t.source_type <> 'payable_payment'
    AND t.occurred_on BETWEEN $2 AND $3
  UNION ALL
  SELECT d.category_id, d.issue_date AS on_date, d.amount
  FROM debts d
  WHERE d.business_id = $1 AND d.type = 'payable' AND d.status <> 'void'
    AND d.issue_date BETWEEN $2 AND $3`;

export async function salesTotals(q, businessId, from, to) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(s.total), 0) AS revenue,
       COALESCE(SUM(s.discount), 0) AS discount,
       COALESCE((SELECT SUM(i.line_cost) FROM sale_items i JOIN sales si ON si.id = i.sale_id
                 WHERE si.business_id = $1 AND si.status = 'active'
                   AND si.sale_date BETWEEN $2 AND $3), 0) AS cogs,
       count(*) AS sale_count
     FROM sales s
     WHERE s.business_id = $1 AND s.status = 'active' AND s.sale_date BETWEEN $2 AND $3`,
    [businessId, from, to],
  );
  return rows[0];
}

export async function otherIncome(q, businessId, from, to) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(t.amount), 0) AS amount, count(*) AS line_count
     FROM transactions t
     WHERE t.business_id = $1 AND t.type = 'income' AND t.deleted_at IS NULL AND NOT t.is_excluded
       AND t.source_type NOT IN ('sale', 'receivable_payment')
       AND t.occurred_on BETWEEN $2 AND $3`,
    [businessId, from, to],
  );
  return rows[0];
}

/** Per category, recognized expenses (BR-010): inventory purchases are in their own group. */
export async function expensesByCategory(q, businessId, from, to) {
  const { rows } = await q.query(
    `SELECT c.id AS category_id, c.name, c.pl_group, SUM(x.amount) AS amount
     FROM (${EXPENSE_LINES}) x
     JOIN categories c ON c.id = x.category_id
     GROUP BY c.id, c.name, c.pl_group
     ORDER BY amount DESC`,
    [businessId, from, to],
  );
  return rows;
}

export async function dailySeries(q, businessId, from, to) {
  const { rows } = await q.query(
    `WITH days AS (
       SELECT d::date AS day FROM generate_series($2::date, $3::date, interval '1 day') d
     ), revenue AS (
       SELECT s.sale_date AS day, SUM(s.total) AS amount FROM sales s
       WHERE s.business_id = $1 AND s.status = 'active' AND s.sale_date BETWEEN $2 AND $3
       GROUP BY s.sale_date
     ), expense AS (
       SELECT x.on_date AS day, SUM(x.amount) AS amount
       FROM (${EXPENSE_LINES}) x JOIN categories c ON c.id = x.category_id
       WHERE c.pl_group <> 'inventory'
       GROUP BY x.on_date
     )
     SELECT days.day::text AS date, COALESCE(r.amount, 0) AS revenue, COALESCE(e.amount, 0) AS expense
     FROM days
     LEFT JOIN revenue r ON r.day = days.day
     LEFT JOIN expense e ON e.day = days.day
     ORDER BY days.day`,
    [businessId, from, to],
  );
  return rows;
}

export async function salesByProduct(q, businessId, from, to) {
  const { rows } = await q.query(
    `SELECT COALESCE(p.name, i.description) AS name, COALESCE(p.unit, '') AS unit,
       SUM(i.qty) AS qty, SUM(i.line_total) AS revenue, SUM(i.line_cost) AS cogs
     FROM sale_items i
     JOIN sales s ON s.id = i.sale_id
     LEFT JOIN products p ON p.id = i.product_id
     WHERE s.business_id = $1 AND s.status = 'active' AND s.sale_date BETWEEN $2 AND $3
     GROUP BY COALESCE(p.name, i.description), COALESCE(p.unit, '')
     ORDER BY revenue DESC`,
    [businessId, from, to],
  );
  return rows;
}

/** Real balances before a date and movements inside a range, per account. */
export async function cashFlowByAccount(q, businessId, from, to, accountId) {
  const { rows } = await q.query(
    `SELECT a.id, a.name,
       a.opening_balance + COALESCE((
         SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount
                         WHEN t.type = 'expense' THEN -t.amount
                         WHEN t.transfer_account_id = a.id THEN t.amount ELSE -t.amount END)
         FROM transactions t
         WHERE t.business_id = a.business_id AND t.deleted_at IS NULL
           AND (t.account_id = a.id OR t.transfer_account_id = a.id) AND t.occurred_on < $2
       ), 0) AS opening,
       COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income' AND NOT t.is_excluded), 0) AS money_in,
       COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND NOT t.is_excluded), 0) AS money_out,
       COALESCE(SUM(CASE WHEN t.type = 'income' AND t.is_excluded THEN t.amount
                         WHEN t.type = 'expense' AND t.is_excluded THEN -t.amount END), 0) AS excluded_net,
       COALESCE(SUM(CASE WHEN t.type = 'transfer' AND t.transfer_account_id = a.id THEN t.amount
                         WHEN t.type = 'transfer' THEN -t.amount END), 0) AS transfer_net
     FROM accounts a
     LEFT JOIN transactions t ON t.business_id = a.business_id AND t.deleted_at IS NULL
       AND (t.account_id = a.id OR t.transfer_account_id = a.id)
       AND t.occurred_on BETWEEN $2 AND $3
     WHERE a.business_id = $1 AND ($4::uuid IS NULL OR a.id = $4)
     GROUP BY a.id, a.name, a.opening_balance, a.business_id
     ORDER BY a.created_at`,
    [businessId, from, to, accountId ?? null],
  );
  return rows;
}

export async function cashFlowByCategory(q, businessId, from, to, accountId) {
  const { rows } = await q.query(
    `SELECT c.name, t.type, SUM(t.amount) AS amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.business_id = $1 AND t.type IN ('income', 'expense')
       AND t.deleted_at IS NULL AND NOT t.is_excluded
       AND t.occurred_on BETWEEN $2 AND $3
       AND ($4::uuid IS NULL OR t.account_id = $4)
     GROUP BY c.name, t.type
     ORDER BY t.type DESC, amount DESC`,
    [businessId, from, to, accountId ?? null],
  );
  return rows;
}

export async function openReceivables(q, businessId, asOf) {
  const { rows } = await q.query(
    `SELECT d.id, c.name AS contact_name, d.issue_date, d.due_date,
       (d.amount - d.paid_amount) AS remaining, ($2::date - d.issue_date) AS age_days
     FROM debts d JOIN contacts c ON c.id = d.contact_id
     WHERE d.business_id = $1 AND d.type = 'receivable' AND d.status IN ('open', 'partial')
       AND d.issue_date <= $2
     ORDER BY d.issue_date`,
    [businessId, asOf],
  );
  return rows;
}

export async function turnoverByMonth(q, businessId, year) {
  const { rows } = await q.query(
    `WITH lines AS (
       SELECT s.sale_date AS on_date, s.total AS amount FROM sales s
       WHERE s.business_id = $1 AND s.status = 'active'
         AND EXTRACT(YEAR FROM s.sale_date) = $2
       UNION ALL
       SELECT t.occurred_on, t.amount FROM transactions t
       WHERE t.business_id = $1 AND t.type = 'income' AND t.deleted_at IS NULL AND NOT t.is_excluded
         AND t.source_type NOT IN ('sale', 'receivable_payment')
         AND EXTRACT(YEAR FROM t.occurred_on) = $2
     )
     SELECT EXTRACT(MONTH FROM on_date)::int AS month, SUM(amount) AS turnover
     FROM lines GROUP BY 1 ORDER BY 1`,
    [businessId, year],
  );
  return rows;
}

export async function topProducts(q, businessId, from, to) {
  const { rows } = await q.query(
    `SELECT COALESCE(p.name, i.description) AS name, SUM(i.line_total) AS revenue, SUM(i.qty) AS qty
     FROM sale_items i
     JOIN sales s ON s.id = i.sale_id
     LEFT JOIN products p ON p.id = i.product_id
     WHERE s.business_id = $1 AND s.status = 'active' AND s.sale_date BETWEEN $2 AND $3
     GROUP BY COALESCE(p.name, i.description)
     ORDER BY revenue DESC
     LIMIT 5`,
    [businessId, from, to],
  );
  return rows;
}

export async function debtSummary(q, businessId, today) {
  const { rows } = await q.query(
    `SELECT
       COALESCE(SUM(amount - paid_amount) FILTER (WHERE type = 'receivable'), 0) AS receivables,
       COALESCE(SUM(amount - paid_amount) FILTER (WHERE type = 'payable'), 0) AS payables,
       count(*) FILTER (WHERE due_date < $2) AS overdue_count,
       COALESCE(SUM(amount - paid_amount) FILTER (WHERE type = 'receivable' AND due_date < $2), 0)
         AS overdue_receivables,
       count(*) FILTER (WHERE type = 'receivable' AND due_date < $2) AS overdue_receivable_count
     FROM debts
     WHERE business_id = $1 AND status IN ('open', 'partial')`,
    [businessId, today],
  );
  return rows[0];
}

export async function salesOnDate(q, businessId, date) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(total), 0) AS total, count(*) AS count
     FROM sales WHERE business_id = $1 AND status = 'active' AND sale_date = $2`,
    [businessId, date],
  );
  return rows[0];
}

export async function lowStockProducts(q, businessId) {
  const { rows } = await q.query(
    `SELECT id, name, unit, stock_qty, low_stock_threshold FROM products
     WHERE business_id = $1 AND is_active AND track_stock
       AND low_stock_threshold IS NOT NULL AND stock_qty <= low_stock_threshold
     ORDER BY stock_qty LIMIT 10`,
    [businessId],
  );
  return rows;
}
