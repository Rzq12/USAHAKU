const COLUMNS = `r.id, r.type, r.account_id, r.category_id, r.amount, r.note, r.frequency, r.start_on,
  r.end_on, r.next_run_on, r.is_active, r.last_run_on, r.last_run_error,
  a.name AS account_name, c.name AS category_name`;
const JOINS = `FROM recurring_rules r
  JOIN accounts a ON a.id = r.account_id
  JOIN categories c ON c.id = r.category_id`;

export async function listRules(q, businessId) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS} ${JOINS} WHERE r.business_id = $1
     ORDER BY r.is_active DESC, r.next_run_on`,
    [businessId],
  );
  return rows;
}

export async function getRule(q, businessId, ruleId) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS}, r.business_id ${JOINS} WHERE r.business_id = $1 AND r.id = $2`,
    [businessId, ruleId],
  );
  return rows[0];
}

export async function insertRule(q, businessId, rule) {
  const { rows } = await q.query(
    `INSERT INTO recurring_rules (business_id, type, account_id, category_id, amount, note, frequency,
       start_on, end_on, next_run_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8) RETURNING id`,
    [
      businessId,
      rule.type,
      rule.account_id,
      rule.category_id,
      rule.amount,
      rule.note,
      rule.frequency,
      rule.start_on,
      rule.end_on,
    ],
  );
  return rows[0].id;
}

export async function updateRule(q, businessId, ruleId, rule) {
  await q.query(
    `UPDATE recurring_rules SET account_id = $3, category_id = $4, amount = $5, note = $6,
       end_on = $7, is_active = $8, next_run_on = $9
     WHERE business_id = $1 AND id = $2`,
    [
      businessId,
      ruleId,
      rule.account_id,
      rule.category_id,
      rule.amount,
      rule.note,
      rule.end_on,
      rule.is_active,
      rule.next_run_on,
    ],
  );
}

export async function advanceRule(q, ruleId, fields) {
  await q.query(
    `UPDATE recurring_rules SET next_run_on = $2, is_active = $3, last_run_on = $4,
       last_run_error = NULL
     WHERE id = $1`,
    [ruleId, fields.next_run_on, fields.is_active, fields.last_run_on],
  );
}

export async function recordRuleError(q, ruleId, message) {
  await q.query('UPDATE recurring_rules SET last_run_error = $2 WHERE id = $1', [ruleId, message]);
}

/** Scheduler scope: all businesses. Each rule is then handled with its own business_id. */
export async function listDueRules(q, today) {
  const { rows } = await q.query(
    `SELECT ${COLUMNS}, r.business_id ${JOINS}
     WHERE r.is_active AND r.next_run_on <= $1 ORDER BY r.next_run_on`,
    [today],
  );
  return rows;
}
