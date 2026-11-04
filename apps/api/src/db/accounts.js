const BALANCE_SQL = `a.opening_balance + COALESCE((
  SELECT SUM(CASE
    WHEN t.type = 'income' THEN t.amount
    WHEN t.type = 'expense' THEN -t.amount
    WHEN t.transfer_account_id = a.id THEN t.amount
    ELSE -t.amount
  END)
  FROM transactions t
  WHERE t.business_id = a.business_id AND t.deleted_at IS NULL
    AND (t.account_id = a.id OR t.transfer_account_id = a.id)
), 0)`;

export async function listAccounts(q, businessId, includeArchived) {
  const { rows } = await q.query(
    `SELECT a.id, a.name, a.type, a.opening_balance, a.is_archived, ${BALANCE_SQL} AS balance
     FROM accounts a
     WHERE a.business_id = $1 AND ($2 OR NOT a.is_archived)
     ORDER BY a.is_archived, a.type = 'cash' DESC, a.created_at, a.name`,
    [businessId, includeArchived],
  );
  return rows;
}

export async function getAccount(q, businessId, accountId) {
  const { rows } = await q.query(
    `SELECT a.id, a.name, a.type, a.opening_balance, a.is_archived, ${BALANCE_SQL} AS balance
     FROM accounts a WHERE a.business_id = $1 AND a.id = $2`,
    [businessId, accountId],
  );
  return rows[0];
}

export async function getAccountBalance(q, businessId, accountId) {
  return (await getAccount(q, businessId, accountId)).balance;
}

export async function insertAccount(q, businessId, account) {
  const { rows } = await q.query(
    `INSERT INTO accounts (business_id, name, type, opening_balance)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [businessId, account.name, account.type, account.opening_balance],
  );
  return rows[0].id;
}

export async function updateAccount(q, businessId, accountId, account) {
  await q.query(
    `UPDATE accounts SET name = $3, type = $4, opening_balance = $5, updated_at = now()
     WHERE business_id = $1 AND id = $2`,
    [businessId, accountId, account.name, account.type, account.opening_balance],
  );
}

export async function setAccountArchived(q, businessId, accountId, isArchived) {
  await q.query(
    'UPDATE accounts SET is_archived = $3, updated_at = now() WHERE business_id = $1 AND id = $2',
    [businessId, accountId, isArchived],
  );
}

export async function accountHasHistory(q, businessId, accountId) {
  const { rows } = await q.query(
    `SELECT EXISTS (
       SELECT 1 FROM transactions
       WHERE business_id = $1 AND (account_id = $2 OR transfer_account_id = $2)
     ) OR EXISTS (
       SELECT 1 FROM sales WHERE business_id = $1 AND account_id = $2
     ) OR EXISTS (
       SELECT 1 FROM recurring_rules WHERE business_id = $1 AND account_id = $2
     ) AS has_history`,
    [businessId, accountId],
  );
  return rows[0].has_history;
}

export async function deleteAccount(q, businessId, accountId) {
  await q.query('DELETE FROM accounts WHERE business_id = $1 AND id = $2', [businessId, accountId]);
}
