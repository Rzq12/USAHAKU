const ENTITIES = [
  {
    file: 'accounts',
    sql: `SELECT id, name, type, opening_balance, is_archived, created_at FROM accounts
          WHERE business_id = $1 ORDER BY created_at`,
  },
  {
    file: 'categories',
    sql: `SELECT id, parent_id, name, type, pl_group, cash_activity, is_archived, created_at
          FROM categories
          WHERE business_id = $1 ORDER BY created_at`,
  },
  {
    file: 'products',
    sql: `SELECT id, sku, name, unit, sell_price, cost_price, track_stock, stock_qty,
            low_stock_threshold, is_active, created_at
          FROM products WHERE business_id = $1 ORDER BY created_at`,
  },
  {
    file: 'stock_movements',
    sql: `SELECT id, product_id, movement_type, qty, ref_id, reason, created_by, created_at
          FROM stock_movements WHERE business_id = $1 ORDER BY created_at`,
  },
  {
    file: 'contacts',
    sql: `SELECT id, name, type, phone, email, address, notes, is_archived, created_at
          FROM contacts WHERE business_id = $1 ORDER BY created_at`,
  },
  {
    file: 'transactions',
    dated: 'occurred_on',
    sql: `SELECT id, type, amount, account_id, transfer_account_id, category_id, contact_id,
            occurred_on, note, source_type, source_id, is_excluded, created_by, created_at, deleted_at
          FROM transactions WHERE business_id = $1`,
  },
  {
    file: 'sales',
    dated: 'sale_date',
    sql: `SELECT id, contact_id, sale_date, subtotal, discount, total, payment_type, account_id,
            status, created_by, created_at
          FROM sales WHERE business_id = $1`,
  },
  {
    file: 'sale_items',
    dated: 's.sale_date',
    sql: `SELECT i.id, i.sale_id, i.product_id, i.description, i.qty, i.unit_price, i.unit_cost,
            i.line_total, i.line_cost
          FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.business_id = $1`,
  },
  {
    file: 'debts',
    dated: 'issue_date',
    sql: `SELECT id, type, contact_id, source_type, source_id, category_id, issue_date, due_date,
            amount, paid_amount, status, note, created_at
          FROM debts WHERE business_id = $1`,
  },
  {
    file: 'payments',
    dated: 'paid_on',
    sql: `SELECT id, debt_id, transaction_id, amount, paid_on, is_void, created_by, created_at
          FROM debt_payments WHERE business_id = $1`,
  },
  {
    file: 'invoices',
    dated: 'issue_date',
    sql: `SELECT id, sale_id, number, issue_date, due_date, status, notes, created_at
          FROM invoices WHERE business_id = $1`,
  },
];

/** One result per entity, with its column names even when it has no rows. */
export async function readAllEntities(q, businessId, { from, to }) {
  const results = [];
  for (const entity of ENTITIES) {
    const params = [businessId];
    let sql = entity.sql;
    if (entity.dated) {
      if (from) {
        params.push(from);
        sql += ` AND ${entity.dated} >= $${params.length}`;
      }
      if (to) {
        params.push(to);
        sql += ` AND ${entity.dated} <= $${params.length}`;
      }
    }
    const result = await q.query(sql, params);
    results.push({
      file: entity.file,
      columns: result.fields.map((field) => field.name),
      rows: result.rows,
    });
  }
  return results;
}
