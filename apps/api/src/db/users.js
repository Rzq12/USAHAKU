const PUBLIC_COLUMNS = `id, business_id, name, email, role, is_active, must_change_password, last_login_at`;

export async function insertBusiness(q, name) {
  const { rows } = await q.query('INSERT INTO businesses (name) VALUES ($1) RETURNING *', [name]);
  return rows[0];
}

export async function insertUser(q, user) {
  const { rows } = await q.query(
    `INSERT INTO users (business_id, name, email, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PUBLIC_COLUMNS}`,
    [user.businessId, user.name, user.email, user.passwordHash, user.role, user.mustChangePassword],
  );
  return rows[0];
}

export async function findUserByEmail(q, email) {
  const { rows } = await q.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0];
}

export async function findUserWithHash(q, userId) {
  const { rows } = await q.query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0];
}

export async function setPassword(q, userId, passwordHash, mustChange) {
  await q.query(
    `UPDATE users SET password_hash = $2, must_change_password = $3, updated_at = now()
     WHERE id = $1`,
    [userId, passwordHash, mustChange],
  );
}

export async function recordLoginSuccess(q, userId) {
  await q.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
     WHERE id = $1`,
    [userId],
  );
}

/**
 * Counts one failed password check in a single statement, so concurrent failures cannot
 * overwrite each other. An expired lock starts a fresh count. Returns the lock time, if set.
 */
export async function recordLoginFailure(q, userId, maxFailures, lockMinutes) {
  const { rows } = await q.query(
    `WITH counted AS (
       SELECT CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
                   ELSE failed_login_count + 1 END AS count
       FROM users WHERE id = $1 FOR UPDATE
     )
     UPDATE users u
     SET failed_login_count = counted.count,
         locked_until = CASE WHEN counted.count >= $2
                             THEN now() + make_interval(mins => $3::int)
                             WHEN u.locked_until <= now() THEN NULL
                             ELSE u.locked_until END
     FROM counted
     WHERE u.id = $1
     RETURNING u.locked_until`,
    [userId, maxFailures, lockMinutes],
  );
  const lockedUntil = rows[0]?.locked_until;
  return lockedUntil && new Date(lockedUntil) > new Date() ? lockedUntil : null;
}

export async function insertSession(q, userId, tokenHash, expiresAt) {
  await q.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    tokenHash,
    expiresAt,
  ]);
}

export async function findSessionUser(q, tokenHash, maxDays) {
  const { rows } = await q.query(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.business_id, u.name, u.email, u.role,
            u.must_change_password, u.is_active, b.name AS business_name, b.period_start_day
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN businesses b ON b.id = u.business_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
       AND s.created_at > now() - make_interval(days => $2::int)`,
    [tokenHash, maxDays],
  );
  return rows[0];
}

export async function extendSession(q, sessionId, expiresAt) {
  await q.query('UPDATE sessions SET expires_at = $2 WHERE id = $1', [sessionId, expiresAt]);
}

export async function deleteSessionByHash(q, tokenHash) {
  await q.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

export async function deleteOtherSessions(q, userId, keepSessionId) {
  await q.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, keepSessionId]);
}

export async function deleteExpiredSessions(q) {
  await q.query(`DELETE FROM sessions WHERE expires_at < now() - interval '30 days'`);
}
