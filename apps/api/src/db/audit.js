const SECRET_FIELDS = new Set([
  'password',
  'password_hash',
  'token',
  'token_hash',
  'temporary_password',
]);

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

export async function deleteExpiredAuditLogs(q) {
  await q.query(`DELETE FROM audit_logs WHERE created_at < now() - interval '2 years'`);
}
