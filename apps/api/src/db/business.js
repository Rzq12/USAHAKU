export async function getBusiness(q, businessId) {
  const { rows } = await q.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
  return rows[0];
}

export async function updateBusiness(q, businessId, b) {
  const { rows } = await q.query(
    `UPDATE businesses SET name = $2, address = $3, phone = $4, npwp = $5, taxpayer_type = $6,
       period_start_day = $7, tax_rate_bp = $8, tax_threshold = $9, payment_info = $10,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      businessId,
      b.name,
      b.address,
      b.phone,
      b.npwp,
      b.taxpayer_type,
      b.period_start_day,
      b.tax_rate_bp,
      b.tax_threshold,
      b.payment_info,
    ],
  );
  return rows[0];
}
