const SECRET_FIELDS = new Set(['password', 'password_hash', 'token', 'token_hash', 'temporary_password']);

function stripSecrets(values) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !SECRET_FIELDS.has(key)));
}

/** Old and new values of the fields that actually changed. */
export function changedFields(before, after) {
  const changes = {};
  for (const key of Object.keys(after)) {
    if (SECRET_FIELDS.has(key) || after[key] === undefined) continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      changes[key] = { old: before[key] ?? null, new: after[key] };
    }
  }
  return changes;
}

export async function writeAudit(client, entry) {
  const { businessId, userId, action, entityType, entityId, detail } = entry;
  await client.query(
    `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      businessId,
      userId ?? null,
      action,
      entityType,
      entityId ?? null,
      detail ? JSON.stringify(stripSecrets(detail)) : null,
    ],
  );
}

export async function listAuditLogs(q, businessId, filters) {
  const where = ['a.business_id = $1'];
  const params = [businessId];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.user_id) add('a.user_id = ?', filters.user_id);
  if (filters.entity_type) add('a.entity_type = ?', filters.entity_type);
  if (filters.action) add('a.action = ?', filters.action);
  if (filters.from) add("a.created_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Jakarta'", filters.from);
  if (filters.to) {
    add("a.created_at < ((?::date) + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'", filters.to);
  }
  const clause = where.join(' AND ');

  const count = await q.query(`SELECT count(*) FROM audit_logs a WHERE ${clause}`, params);
  const offset = (filters.page - 1) * filters.limit;
  const { rows } = await q.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at,
            a.user_id, u.name AS user_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${clause}
     ORDER BY a.created_at DESC
     LIMIT ${filters.limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows, total: Number(count.rows[0].count) };
}

export async function deleteExpiredAuditLogs(q) {
  await q.query(`DELETE FROM audit_logs WHERE created_at < now() - interval '2 years'`);
}
