const COLUMNS = `p.id, p.sku, p.name, p.unit, p.sell_price, p.cost_price, p.track_stock, p.stock_qty,
  p.low_stock_threshold, p.is_active,
  (p.track_stock AND p.low_stock_threshold IS NOT NULL AND p.stock_qty <= p.low_stock_threshold) AS low_stock`;

export async function listProducts(q, businessId, filters) {
  const where = ['p.business_id = $1'];
  const params = [businessId];
  if (!filters.include_inactive) where.push('p.is_active');
  if (filters.low_stock) {
    where.push('p.track_stock AND p.low_stock_threshold IS NOT NULL');
    where.push('p.stock_qty <= p.low_stock_threshold');
  }
  if (filters.q) {
    params.push(filters.q);
    where.push(`(p.name ILIKE '%' || $${params.length} || '%' OR p.sku ILIKE '%' || $${params.length} || '%')`);
  }
  const clause = where.join(' AND ');
  const count = await q.query(`SELECT count(*) FROM products p WHERE ${clause}`, params);
  const offset = (filters.page - 1) * filters.limit;
  const { rows } = await q.query(
    `SELECT ${COLUMNS} FROM products p WHERE ${clause} ORDER BY p.is_active DESC, p.name
     LIMIT ${filters.limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows, total: Number(count.rows[0].count) };
}

export async function getProduct(q, businessId, productId) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS} FROM products p WHERE p.business_id = $1 AND p.id = $2`,
    [businessId, productId],
  );
  return rows[0];
}

export async function lockProducts(q, businessId, productIds) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS} FROM products p
     WHERE p.business_id = $1 AND p.id = ANY($2::uuid[])
     ORDER BY p.id FOR UPDATE`,
    [businessId, productIds],
  );
  return rows;
}

export async function insertProduct(q, businessId, product) {
  const { rows } = await q.query(
    `INSERT INTO products (business_id, sku, name, unit, sell_price, cost_price, track_stock,
       low_stock_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      businessId,
      product.sku,
      product.name,
      product.unit,
      product.sell_price,
      product.cost_price,
      product.track_stock,
      product.low_stock_threshold,
    ],
  );
  return rows[0].id;
}

export async function updateProduct(q, businessId, productId, product) {
  await q.query(
    `UPDATE products SET sku = $3, name = $4, unit = $5, sell_price = $6, cost_price = $7,
       track_stock = $8, low_stock_threshold = $9, is_active = $10, updated_at = now()
     WHERE business_id = $1 AND id = $2`,
    [
      businessId,
      productId,
      product.sku,
      product.name,
      product.unit,
      product.sell_price,
      product.cost_price,
      product.track_stock,
      product.low_stock_threshold,
      product.is_active,
    ],
  );
}

export async function setCostPrice(q, businessId, productId, costPrice) {
  await q.query(
    'UPDATE products SET cost_price = $3, updated_at = now() WHERE business_id = $1 AND id = $2',
    [businessId, productId, costPrice],
  );
}

/** The only place stock changes: the movement and the stock figure move together. */
export async function writeStockMovement(q, movement) {
  await q.query(
    `INSERT INTO stock_movements (business_id, product_id, movement_type, qty, ref_id, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      movement.businessId,
      movement.productId,
      movement.type,
      movement.qty,
      movement.refId ?? null,
      movement.reason ?? null,
      movement.userId ?? null,
    ],
  );
  await q.query(
    `UPDATE products SET stock_qty = stock_qty + $3, updated_at = now()
     WHERE business_id = $1 AND id = $2`,
    [movement.businessId, movement.productId, movement.qty],
  );
}

export async function listMovements(q, businessId, productId, { page, limit }) {
  const count = await q.query(
    'SELECT count(*) FROM stock_movements WHERE business_id = $1 AND product_id = $2',
    [businessId, productId],
  );
  const { rows } = await q.query(
    `SELECT m.id, m.movement_type, m.qty, m.reason, m.ref_id, m.created_at, u.name AS created_by_name
     FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
     WHERE m.business_id = $1 AND m.product_id = $2
     ORDER BY m.created_at DESC
     LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    [businessId, productId],
  );
  return { items: rows, total: Number(count.rows[0].count) };
}

export async function listSaleMovements(q, businessId, saleId) {
  const { rows } = await q.query(
    `SELECT product_id, qty FROM stock_movements
     WHERE business_id = $1 AND ref_id = $2 AND movement_type = 'sale'
     ORDER BY product_id`,
    [businessId, saleId],
  );
  return rows;
}
