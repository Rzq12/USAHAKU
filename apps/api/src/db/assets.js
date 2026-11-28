const ASSET_COLUMNS = `a.id, a.kind, a.group_name, a.name, a.acquired_on, a.cost,
  a.useful_life_months, a.expense_category_id, c.name AS expense_category_name,
  c.pl_group AS expense_pl_group, parent.name AS expense_parent_name`;

const ASSET_FROM = `assets a
  JOIN categories c ON c.id = a.expense_category_id AND c.business_id = a.business_id
  LEFT JOIN categories parent ON parent.id = c.parent_id AND parent.business_id = c.business_id`;

/** Assets owned on `asOf` (all of them when it is null), oldest first. */
export async function listAssets(q, businessId, asOf = null) {
  const { rows } = await q.query(
    `SELECT ${ASSET_COLUMNS} FROM ${ASSET_FROM}
     WHERE a.business_id = $1 AND ($2::date IS NULL OR a.acquired_on <= $2)
     ORDER BY a.acquired_on, a.created_at`,
    [businessId, asOf],
  );
  return rows;
}

export async function getAsset(q, businessId, assetId) {
  const { rows } = await q.query(
    `SELECT ${ASSET_COLUMNS} FROM ${ASSET_FROM} WHERE a.business_id = $1 AND a.id = $2`,
    [businessId, assetId],
  );
  return rows[0];
}

export async function insertAsset(q, businessId, asset) {
  const { rows } = await q.query(
    `INSERT INTO assets (business_id, kind, group_name, name, acquired_on, cost,
       useful_life_months, expense_category_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      businessId,
      asset.kind,
      asset.group_name,
      asset.name,
      asset.acquired_on,
      asset.cost,
      asset.useful_life_months,
      asset.expense_category_id,
    ],
  );
  return rows[0].id;
}

export async function deleteAsset(q, businessId, assetId) {
  await q.query('DELETE FROM assets WHERE business_id = $1 AND id = $2', [businessId, assetId]);
}

export async function latestAcquisition(q, businessId) {
  const { rows } = await q.query(
    'SELECT MAX(acquired_on) AS latest FROM assets WHERE business_id = $1',
    [businessId],
  );
  return rows[0].latest;
}
