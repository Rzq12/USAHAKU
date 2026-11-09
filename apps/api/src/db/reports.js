/*
 * Reports read from here. Revenue comes from sales, never from income transactions linked to sales.
 * Transfers and debt payments never reach profit and loss (BR-002, BR-008).
 * Investing and financing categories (capital, loans, equipment) are cash movements too:
 * they appear in cash flow but never in profit and loss or tax turnover.
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
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.business_id = $1 AND t.type = 'income' AND t.deleted_at IS NULL AND NOT t.is_excluded
       AND t.source_type NOT IN ('sale', 'receivable_payment')
       AND c.cash_activity = 'operating'
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
     WHERE c.cash_activity = 'operating'
     GROUP BY c.id, c.name, c.pl_group
     ORDER BY amount DESC`,
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
    `SELECT c.cash_activity AS activity, t.type,
       CASE WHEN t.source_type = 'receivable_payment' THEN 'Pelunasan piutang' ELSE c.name END AS name,
       SUM(t.amount) AS amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.business_id = $1 AND t.type IN ('income', 'expense')
       AND t.deleted_at IS NULL AND NOT t.is_excluded
       AND t.occurred_on BETWEEN $2 AND $3
       AND ($4::uuid IS NULL OR t.account_id = $4)
     GROUP BY 1, 2, 3
     ORDER BY t.type DESC, amount DESC`,
    [businessId, from, to, accountId ?? null],
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
       SELECT t.occurred_on, t.amount
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.business_id = $1 AND t.type = 'income' AND t.deleted_at IS NULL AND NOT t.is_excluded
         AND t.source_type NOT IN ('sale', 'receivable_payment')
         AND c.cash_activity = 'operating'
         AND EXTRACT(YEAR FROM t.occurred_on) = $2
     )
     SELECT EXTRACT(MONTH FROM on_date)::int AS month, SUM(amount) AS turnover
     FROM lines GROUP BY 1 ORDER BY 1`,
    [businessId, year],
  );
  return rows;
}
