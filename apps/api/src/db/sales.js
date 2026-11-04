export async function insertSale(q, businessId, sale) {
  const { rows } = await q.query(
    `INSERT INTO sales (business_id, contact_id, sale_date, subtotal, discount, total, payment_type,
       account_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      businessId,
      sale.contact_id,
      sale.sale_date,
      sale.subtotal,
      sale.discount,
      sale.total,
      sale.payment_type,
      sale.account_id,
      sale.created_by,
    ],
  );
  return rows[0].id;
}

export async function insertSaleItem(q, businessId, saleId, item) {
  await q.query(
    `INSERT INTO sale_items (business_id, sale_id, product_id, description, qty, unit_price,
       unit_cost, line_total, line_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      businessId,
      saleId,
      item.product_id,
      item.description,
      item.qty,
      item.unit_price,
      item.unit_cost,
      item.line_total,
      item.line_cost,
    ],
  );
}

const PAYMENT_STATUS_SQL = `CASE
  WHEN s.status = 'void' THEN 'void'
  WHEN s.payment_type = 'paid' THEN 'paid'
  ELSE COALESCE((SELECT d.status FROM debts d
                 WHERE d.business_id = s.business_id AND d.source_type = 'sale' AND d.source_id = s.id
                 LIMIT 1), 'open')
END`;

const COLUMNS = `s.id, s.contact_id, s.sale_date, s.subtotal, s.discount, s.total, s.payment_type,
  s.account_id, s.status, s.created_by, s.created_at,
  c.name AS contact_name, a.name AS account_name, u.name AS created_by_name,
  i.id AS invoice_id, i.number AS invoice_number, ${PAYMENT_STATUS_SQL} AS payment_status`;

const JOINS = `FROM sales s
  LEFT JOIN contacts c ON c.id = s.contact_id
  LEFT JOIN accounts a ON a.id = s.account_id
  LEFT JOIN users u ON u.id = s.created_by
  LEFT JOIN invoices i ON i.sale_id = s.id`;

export async function getSale(q, businessId, saleId) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS} ${JOINS} WHERE s.business_id = $1 AND s.id = $2`,
    [businessId, saleId],
  );
  return rows[0];
}

export async function lockSale(q, businessId, saleId) {
  const { rows } = await q.query(
    'SELECT * FROM sales WHERE business_id = $1 AND id = $2 FOR UPDATE',
    [businessId, saleId],
  );
  return rows[0];
}

export async function listSaleItems(q, businessId, saleId) {
  const { rows } = await q.query(
    `SELECT id, product_id, description, qty, unit_price, unit_cost, line_total, line_cost
     FROM sale_items WHERE business_id = $1 AND sale_id = $2 ORDER BY created_at, id`,
    [businessId, saleId],
  );
  return rows;
}

export async function listSales(q, businessId, filters) {
  const where = ['s.business_id = $1'];
  const params = [businessId];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.created_by) add('s.created_by = ?', filters.created_by);
  if (filters.from) add('s.sale_date >= ?', filters.from);
  if (filters.to) add('s.sale_date <= ?', filters.to);
  if (filters.contact_id) add('s.contact_id = ?', filters.contact_id);
  if (filters.payment_status) add(`${PAYMENT_STATUS_SQL} = ?`, filters.payment_status);
  const clause = where.join(' AND ');
  const count = await q.query(`SELECT count(*) FROM sales s WHERE ${clause}`, params);
  const { rows } = await q.query(
    `SELECT ${COLUMNS} ${JOINS} WHERE ${clause}
     ORDER BY s.sale_date DESC, s.created_at DESC
     LIMIT ${filters.limit} OFFSET ${(filters.page - 1) * filters.limit}`,
    params,
  );
  return { items: rows, total: Number(count.rows[0].count) };
}

export async function markSaleVoid(q, businessId, saleId) {
  await q.query(`UPDATE sales SET status = 'void' WHERE business_id = $1 AND id = $2`, [
    businessId,
    saleId,
  ]);
}
