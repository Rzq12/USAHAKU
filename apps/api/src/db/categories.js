const DEFAULT_CATEGORIES = [
  { name: 'Penjualan', type: 'income', system_key: 'sales' },
  { name: 'Pendapatan Lain', type: 'income' },
  { name: 'Pembelian Stok', type: 'expense', pl_group: 'inventory', system_key: 'inventory' },
  { name: 'Sewa', type: 'expense', pl_group: 'operating_expense' },
  { name: 'Listrik dan Utilitas', type: 'expense', pl_group: 'operating_expense' },
  { name: 'Gaji', type: 'expense', pl_group: 'operating_expense' },
  { name: 'Transportasi', type: 'expense', pl_group: 'operating_expense' },
  { name: 'Pemasaran', type: 'expense', pl_group: 'operating_expense' },
  { name: 'Perlengkapan', type: 'expense', pl_group: 'operating_expense' },
  { name: 'Lainnya', type: 'expense', pl_group: 'operating_expense' },
  { name: 'Pajak', type: 'expense', pl_group: 'other_expense', system_key: 'tax' },
];

export async function insertDefaultCategories(q, businessId) {
  for (const category of DEFAULT_CATEGORIES) {
    await q.query(
      `INSERT INTO categories (business_id, name, type, pl_group, system_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [businessId, category.name, category.type, category.pl_group ?? null, category.system_key ?? null],
    );
  }
}

export async function listCategories(q, businessId, includeArchived) {
  const { rows } = await q.query(
    `SELECT c.id, c.parent_id, c.name, c.type, c.pl_group, c.system_key, c.is_archived,
            (SELECT count(*) FROM transactions t
             WHERE t.business_id = c.business_id AND t.category_id = c.id AND t.deleted_at IS NULL
            ) AS usage_count
     FROM categories c
     WHERE c.business_id = $1 AND ($2 OR NOT c.is_archived)
     ORDER BY c.type DESC, c.name`,
    [businessId, includeArchived],
  );
  return rows;
}

export async function getCategory(q, businessId, categoryId) {
  const { rows } = await q.query('SELECT * FROM categories WHERE business_id = $1 AND id = $2', [
    businessId,
    categoryId,
  ]);
  return rows[0];
}

export async function getSystemCategory(q, businessId, systemKey) {
  const { rows } = await q.query(
    'SELECT * FROM categories WHERE business_id = $1 AND system_key = $2',
    [businessId, systemKey],
  );
  return rows[0];
}

export async function insertCategory(q, businessId, category) {
  const { rows } = await q.query(
    `INSERT INTO categories (business_id, parent_id, name, type, pl_group)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [businessId, category.parent_id, category.name, category.type, category.pl_group],
  );
  return rows[0];
}

export async function updateCategory(q, businessId, categoryId, category) {
  const { rows } = await q.query(
    `UPDATE categories SET name = $3, pl_group = $4, is_archived = $5
     WHERE business_id = $1 AND id = $2 RETURNING *`,
    [businessId, categoryId, category.name, category.pl_group, category.is_archived],
  );
  return rows[0];
}

export async function categoryHasHistory(q, businessId, categoryId) {
  const { rows } = await q.query(
    `SELECT EXISTS (SELECT 1 FROM transactions WHERE business_id = $1 AND category_id = $2)
         OR EXISTS (SELECT 1 FROM categories WHERE business_id = $1 AND parent_id = $2)
         OR EXISTS (SELECT 1 FROM debts WHERE business_id = $1 AND category_id = $2)
         OR EXISTS (SELECT 1 FROM budget_items WHERE business_id = $1 AND category_id = $2)
         OR EXISTS (SELECT 1 FROM recurring_rules WHERE business_id = $1 AND category_id = $2)
         AS has_history`,
    [businessId, categoryId],
  );
  return rows[0].has_history;
}

export async function deleteCategory(q, businessId, categoryId) {
  await q.query('DELETE FROM category_rules WHERE business_id = $1 AND category_id = $2', [
    businessId,
    categoryId,
  ]);
  await q.query('DELETE FROM categories WHERE business_id = $1 AND id = $2', [businessId, categoryId]);
}

export async function listRules(q, businessId) {
  const { rows } = await q.query(
    `SELECT r.id, r.keyword, r.priority, r.category_id, c.name AS category_name, c.type AS category_type
     FROM category_rules r JOIN categories c ON c.id = r.category_id
     WHERE r.business_id = $1
     ORDER BY r.priority DESC, length(r.keyword) DESC`,
    [businessId],
  );
  return rows;
}

export async function getRule(q, businessId, ruleId) {
  const { rows } = await q.query('SELECT * FROM category_rules WHERE business_id = $1 AND id = $2', [
    businessId,
    ruleId,
  ]);
  return rows[0];
}

export async function insertRule(q, businessId, rule) {
  const { rows } = await q.query(
    `INSERT INTO category_rules (business_id, category_id, keyword, priority)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [businessId, rule.category_id, rule.keyword, rule.priority],
  );
  return rows[0];
}

export async function updateRule(q, businessId, ruleId, rule) {
  const { rows } = await q.query(
    `UPDATE category_rules SET category_id = $3, keyword = $4, priority = $5
     WHERE business_id = $1 AND id = $2 RETURNING *`,
    [businessId, ruleId, rule.category_id, rule.keyword, rule.priority],
  );
  return rows[0];
}

export async function deleteRule(q, businessId, ruleId) {
  await q.query('DELETE FROM category_rules WHERE business_id = $1 AND id = $2', [businessId, ruleId]);
}

/** Highest priority wins; on equal priority the longer keyword wins. */
export async function matchRule(q, businessId, note, type) {
  const { rows } = await q.query(
    `SELECT r.category_id, c.name AS category_name, c.type, r.keyword, r.priority
     FROM category_rules r JOIN categories c ON c.id = r.category_id
     WHERE r.business_id = $1 AND NOT c.is_archived
       AND position(r.keyword IN lower($2)) > 0
       AND ($3::text IS NULL OR c.type = $3)
     ORDER BY r.priority DESC, length(r.keyword) DESC
     LIMIT 1`,
    [businessId, note, type ?? null],
  );
  return rows[0] ?? null;
}

export async function listTags(q, businessId) {
  const { rows } = await q.query('SELECT id, name FROM tags WHERE business_id = $1 ORDER BY name', [
    businessId,
  ]);
  return rows;
}
