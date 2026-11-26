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
       COALESCE((SELECT SUM(i.line_cost) FROM sale_items i JOIN sales si ON si.id = i.sale_id AND si.business_id = i.business_id
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
     FROM transactions t JOIN categories c ON c.id = t.category_id AND c.business_id = t.business_id
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
    `SELECT c.id AS category_id, c.name, c.pl_group, parent.name AS parent_name,
       SUM(x.amount) AS amount
     FROM (${EXPENSE_LINES}) x
     JOIN categories c ON c.id = x.category_id AND c.business_id = $1
     LEFT JOIN categories parent ON parent.id = c.parent_id AND parent.business_id = c.business_id
     WHERE c.cash_activity = 'operating'
     GROUP BY c.id, c.name, c.pl_group, parent.name
     ORDER BY amount DESC`,
    [businessId, from, to],
  );
  return rows;
}

export async function salesByProduct(q, businessId, from, to) {
  const { rows } = await q.query(
    // Grouped by the name saved on each sale line, so renaming a product never relabels old sales.
    `SELECT i.description AS name, COALESCE(MAX(p.unit), '') AS unit,
       SUM(i.qty) AS qty, SUM(i.line_total) AS revenue, SUM(i.line_cost) AS cogs
     FROM sale_items i
     JOIN sales s ON s.id = i.sale_id AND s.business_id = i.business_id
     LEFT JOIN products p ON p.id = i.product_id AND p.business_id = i.business_id
     WHERE s.business_id = $1 AND s.status = 'active' AND s.sale_date BETWEEN $2 AND $3
     GROUP BY i.product_id, i.description
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
     FROM transactions t JOIN categories c ON c.id = t.category_id AND c.business_id = t.business_id
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

/*
 * Balance sheet inputs, all cumulative up to one date. A sale's stock movements take the
 * sale date, so a backdated sale leaves stock on the same day its cost reaches profit.
 * Other movements only have created_at, read in Jakarta time.
 */
const STOCK_ON_DATE = `
  SELECT m.product_id, m.movement_type, m.qty
  FROM stock_movements m
  LEFT JOIN sales s ON m.movement_type IN ('sale', 'void') AND s.id = m.ref_id AND s.business_id = m.business_id
  WHERE m.business_id = $1
    AND COALESCE(s.sale_date, (m.created_at AT TIME ZONE 'Asia/Jakarta')::date) <= $2`;

export async function balanceSheetFigures(q, businessId, asOf) {
  const [accounts, debts, stock, nonOperating] = await Promise.all([
    q.query(
      `SELECT a.name, a.opening_balance,
         a.opening_balance + COALESCE((
           SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount
                           WHEN t.type = 'expense' THEN -t.amount
                           WHEN t.transfer_account_id = a.id THEN t.amount ELSE -t.amount END)
           FROM transactions t
           WHERE t.business_id = a.business_id AND t.deleted_at IS NULL
             AND (t.account_id = a.id OR t.transfer_account_id = a.id) AND t.occurred_on <= $2
         ), 0) AS balance
       FROM accounts a
       WHERE a.business_id = $1
       ORDER BY a.created_at`,
      [businessId, asOf],
    ),
    q.query(
      `SELECT d.type, COALESCE(SUM(d.amount - COALESCE((
           SELECT SUM(p.amount) FROM debt_payments p
           WHERE p.debt_id = d.id AND NOT p.is_void AND p.paid_on <= $2
         ), 0)), 0) AS open_amount
       FROM debts d
       WHERE d.business_id = $1 AND d.status <> 'void' AND d.issue_date <= $2
       GROUP BY d.type`,
      [businessId, asOf],
    ),
    q.query(
      `SELECT COALESCE(SUM(ROUND(x.qty * p.cost_price)), 0) AS inventory,
         COALESCE(SUM(ROUND(COALESCE(x.opening_qty, 0) * p.cost_price)), 0) AS opening_stock
       FROM (
         SELECT product_id, SUM(qty) AS qty,
           SUM(qty) FILTER (WHERE movement_type = 'opening') AS opening_qty
         FROM (${STOCK_ON_DATE}) m
         GROUP BY product_id
       ) x
       JOIN products p ON p.id = x.product_id AND p.business_id = $1`,
      [businessId, asOf],
    ),
    // Investing and financing amounts. A payable bill counts when issued; paying it later
    // only settles the debt, so payable payments are left out here.
    q.query(
      `SELECT c.cash_activity AS activity, c.type, c.name, SUM(x.amount) AS amount
       FROM (
         SELECT t.category_id, t.amount
         FROM transactions t
         WHERE t.business_id = $1 AND t.type IN ('income', 'expense') AND t.deleted_at IS NULL
           AND NOT t.is_excluded AND t.source_type <> 'payable_payment' AND t.occurred_on <= $2
         UNION ALL
         SELECT d.category_id, d.amount
         FROM debts d
         WHERE d.business_id = $1 AND d.type = 'payable' AND d.status <> 'void'
           AND d.issue_date <= $2
       ) x
       JOIN categories c ON c.id = x.category_id AND c.business_id = $1
       WHERE c.cash_activity <> 'operating'
       GROUP BY c.cash_activity, c.type, c.name
       ORDER BY c.name`,
      [businessId, asOf],
    ),
  ]);
  const openDebt = (type) => debts.rows.find((row) => row.type === type)?.open_amount ?? 0;
  return {
    accounts: accounts.rows,
    receivables: openDebt('receivable'),
    payables: openDebt('payable'),
    inventory: stock.rows[0].inventory,
    opening_stock: stock.rows[0].opening_stock,
    non_operating: nonOperating.rows,
  };
}

export async function turnoverByMonth(q, businessId, year) {
  const { rows } = await q.query(
    `WITH lines AS (
       SELECT s.sale_date AS on_date, s.total AS amount FROM sales s
       WHERE s.business_id = $1 AND s.status = 'active'
         AND EXTRACT(YEAR FROM s.sale_date) = $2
       UNION ALL
       SELECT t.occurred_on, t.amount
       FROM transactions t JOIN categories c ON c.id = t.category_id AND c.business_id = t.business_id
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
