const COLUMNS = `d.id, d.type, d.contact_id, d.source_type, d.source_id, d.category_id, d.issue_date,
  d.due_date, d.amount, d.paid_amount, d.status, d.note, d.created_at,
  (d.amount - d.paid_amount) AS remaining,
  c.name AS contact_name, cat.name AS category_name`;

const JOINS = `FROM debts d
  JOIN contacts c ON c.id = d.contact_id
  LEFT JOIN categories cat ON cat.id = d.category_id`;

export async function insertDebt(q, businessId, debt) {
  const { rows } = await q.query(
    `INSERT INTO debts (business_id, type, contact_id, source_type, source_id, category_id,
       issue_date, due_date, amount, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      businessId,
      debt.type,
      debt.contact_id,
      debt.source_type,
      debt.source_id ?? null,
      debt.category_id ?? null,
      debt.issue_date,
      debt.due_date,
      debt.amount,
      debt.note ?? null,
      debt.created_by ?? null,
    ],
  );
  return rows[0].id;
}

export async function getDebt(q, businessId, debtId) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS} ${JOINS} WHERE d.business_id = $1 AND d.id = $2`,
    [businessId, debtId],
  );
  return rows[0];
}

export async function lockDebt(q, businessId, debtId) {
  await q.query('SELECT id FROM debts WHERE business_id = $1 AND id = $2 FOR UPDATE', [
    businessId,
    debtId,
  ]);
  return getDebt(q, businessId, debtId);
}

export async function findDebtBySale(q, businessId, saleId) {
  const { rows } = await q.query(
    `SELECT id FROM debts WHERE business_id = $1 AND source_type = 'sale' AND source_id = $2`,
    [businessId, saleId],
  );
  return rows[0]?.id;
}

export async function hasOpenDebts(q, businessId, contactId) {
  const { rows } = await q.query(
    `SELECT EXISTS (
       SELECT 1 FROM debts
       WHERE business_id = $1 AND contact_id = $2 AND status IN ('open', 'partial')
     ) AS has_open`,
    [businessId, contactId],
  );
  return rows[0].has_open;
}

export async function setDebtPaid(q, businessId, debtId, paidAmount, status) {
  await q.query(
    'UPDATE debts SET paid_amount = $3, status = $4 WHERE business_id = $1 AND id = $2',
    [businessId, debtId, paidAmount, status],
  );
}

export async function voidDebt(q, businessId, debtId) {
  await q.query(`UPDATE debts SET status = 'void' WHERE business_id = $1 AND id = $2`, [
    businessId,
    debtId,
  ]);
}

export async function listDebts(q, businessId, filters) {
  const where = ['d.business_id = $1'];
  const params = [businessId, filters.today];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.type) add('d.type = ?', filters.type);
  if (filters.contact_id) add('d.contact_id = ?', filters.contact_id);
  if (filters.status === 'overdue') {
    where.push(`d.status IN ('open', 'partial') AND d.due_date < $2`);
  } else if (filters.status === 'unpaid') {
    where.push(`d.status IN ('open', 'partial')`);
  } else if (filters.status) {
    add('d.status = ?', filters.status);
  } else {
    where.push(`d.status <> 'void'`);
  }
  const clause = where.join(' AND ');
  const summary = await q.query(
    `SELECT count(*) AS total,
       COALESCE(SUM(d.amount - d.paid_amount) FILTER (WHERE d.status IN ('open', 'partial')), 0) AS remaining,
       $2::date AS today
     FROM debts d WHERE ${clause}`,
    params,
  );
  const { rows } = await q.query(
    `SELECT ${COLUMNS},
       CASE WHEN d.status IN ('open', 'partial') AND d.due_date < $2
            THEN ($2::date - d.due_date) ELSE 0 END AS days_overdue
     ${JOINS} WHERE ${clause}
     ORDER BY (d.status IN ('open', 'partial')) DESC, d.due_date, d.created_at
     LIMIT ${filters.limit} OFFSET ${(filters.page - 1) * filters.limit}`,
    params,
  );
  return { items: rows, total: summary.rows[0].total, remaining: summary.rows[0].remaining };
}

export async function insertPayment(q, businessId, payment) {
  const { rows } = await q.query(
    `INSERT INTO debt_payments (business_id, debt_id, transaction_id, amount, paid_on, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      businessId,
      payment.debt_id,
      payment.transaction_id,
      payment.amount,
      payment.paid_on,
      payment.created_by,
    ],
  );
  return rows[0].id;
}

export async function listPayments(q, businessId, debtId) {
  const { rows } = await q.query(
    `SELECT p.id, p.amount, p.paid_on, p.is_void, p.transaction_id, p.created_at,
            a.name AS account_name, u.name AS created_by_name
     FROM debt_payments p
     JOIN transactions t ON t.id = p.transaction_id
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.business_id = $1 AND p.debt_id = $2
     ORDER BY p.paid_on DESC, p.created_at DESC`,
    [businessId, debtId],
  );
  return rows;
}

export async function getPayment(q, businessId, debtId, paymentId) {
  const { rows } = await q.query(
    'SELECT * FROM debt_payments WHERE business_id = $1 AND debt_id = $2 AND id = $3',
    [businessId, debtId, paymentId],
  );
  return rows[0];
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
