/* Receivables are a retired feature. Only voiding an old sale still touches these rows. */

export async function findDebtBySale(q, businessId, saleId) {
  const { rows } = await q.query(
    `SELECT id FROM debts WHERE business_id = $1 AND source_type = 'sale' AND source_id = $2`,
    [businessId, saleId],
  );
  return rows[0]?.id;
}

export async function setDebtPaid(q, businessId, debtId, paidAmount, status) {
  await q.query(
    'UPDATE debts SET paid_amount = $3, status = $4 WHERE business_id = $1 AND id = $2',
    [businessId, debtId, paidAmount, status],
  );
}

export async function markPaymentVoid(q, businessId, paymentId) {
  await q.query('UPDATE debt_payments SET is_void = true WHERE business_id = $1 AND id = $2', [
    businessId,
    paymentId,
  ]);
}

export async function listActivePayments(q, businessId, debtId) {
  const { rows } = await q.query(
    'SELECT * FROM debt_payments WHERE business_id = $1 AND debt_id = $2 AND NOT is_void',
    [businessId, debtId],
  );
  return rows;
}
