export async function getBusiness(q, businessId) {
  const { rows } = await q.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
  return rows[0];
}

export async function updateBusiness(q, businessId, b) {
  const { rows } = await q.query(
    `UPDATE businesses SET name = $2, address = $3, phone = $4, period_start_day = $5,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [businessId, b.name, b.address, b.phone, b.period_start_day],
  );
  return rows[0];
}
