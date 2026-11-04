import { createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { extendSession, findSessionUser } from '../db/users.js';
import { config } from '../config.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { handle } from '../lib/http.js';

export const SESSION_COOKIE = 'usahaku_session';
const SLIDE_AFTER_MS = 60 * 60 * 1000;

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry() {
  return new Date(Date.now() + config.sessionDays * 86_400_000);
}

export const requireAuth = handle(async (req, _res, next) => {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) throw unauthorized();
  const user = await findSessionUser(pool, hashToken(token));
  if (!user || !user.is_active) throw unauthorized();

  const nextExpiry = sessionExpiry();
  if (nextExpiry.getTime() - new Date(user.expires_at).getTime() > SLIDE_AFTER_MS) {
    await extendSession(pool, user.session_id, nextExpiry);
  }
  req.user = user;

  const onAuthRoute = req.originalUrl.startsWith('/api/auth/');
  if (user.must_change_password && !onAuthRoute) {
    throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Ganti kata sandi terlebih dahulu.');
  }
  next();
});

export const requireRole = (...roles) =>
  function checkRole(req, _res, next) {
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export const OWNER = 'owner';
export const STAFF = 'staff';
export const ACCOUNTANT = 'accountant';
