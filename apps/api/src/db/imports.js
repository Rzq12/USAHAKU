/** Existing rows on an account inside a date range, for duplicate detection (BR-014). */
export async function existingSignatures(q, businessId, accountId, from, to) {
  const { rows } = await q.query(
    `SELECT occurred_on, amount, COALESCE(note, '') AS note FROM transactions
     WHERE business_id = $1 AND account_id = $2 AND deleted_at IS NULL
       AND occurred_on BETWEEN $3 AND $4`,
    [businessId, accountId, from, to],
  );
  return rows;
}
