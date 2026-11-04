export async function upsertBudget(q, businessId, periodStart) {
  const { rows } = await q.query(
    `INSERT INTO budgets (business_id, period_start) VALUES ($1, $2)
     ON CONFLICT (business_id, period_start) DO UPDATE SET period_start = EXCLUDED.period_start
     RETURNING id`,
    [businessId, periodStart],
  );
  return rows[0].id;
}

export async function replaceBudgetItems(q, businessId, budgetId, items) {
  await q.query('DELETE FROM budget_items WHERE business_id = $1 AND budget_id = $2', [
    businessId,
    budgetId,
  ]);
  for (const item of items) {
    await q.query(
      `INSERT INTO budget_items (business_id, budget_id, category_id, amount)
       VALUES ($1, $2, $3, $4)`,
      [businessId, budgetId, item.category_id, item.amount],
    );
  }
}

/** Used = expense transactions in the category or its subcategories, inventory excluded. */
export async function budgetUsage(q, businessId, period) {
  const { rows } = await q.query(
    `SELECT i.category_id, c.name AS category_name, i.amount AS budget,
       COALESCE((
         SELECT SUM(t.amount)
         FROM transactions t JOIN categories tc ON tc.id = t.category_id
         WHERE t.business_id = i.business_id AND t.type = 'expense'
           AND t.deleted_at IS NULL AND NOT t.is_excluded
           AND tc.pl_group <> 'inventory'
           AND (tc.id = i.category_id OR tc.parent_id = i.category_id)
           AND t.occurred_on BETWEEN $3 AND $4
       ), 0) AS used
     FROM budgets b
     JOIN budget_items i ON i.budget_id = b.id
     JOIN categories c ON c.id = i.category_id
     WHERE b.business_id = $1 AND b.period_start = $2
     ORDER BY c.name`,
    [businessId, period.from, period.from, period.to],
  );
  return rows;
}
