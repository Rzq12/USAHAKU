import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { pool, withTx } from '../db/pool.js';
import * as users from '../db/users.js';
import { insertAccount } from '../db/accounts.js';
import { insertDefaultCategories } from '../db/categories.js';
import { writeAudit } from '../db/audit.js';
import { hashToken, sessionExpiry } from '../middleware/auth.js';
import { AppError, fieldError, rethrowUnique, unauthorized } from '../lib/errors.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const WRONG_CREDENTIALS = 'Email atau kata sandi salah.';
const EMAIL_TAKEN = {
  users_email_key: { field: 'email', message: 'Email sudah terdaftar.' },
};

export function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function assertPasswordAllowed(password, email) {
  if (password.toLowerCase() === email.toLowerCase()) {
    throw fieldError('password', 'Kata sandi tidak boleh sama dengan email.');
  }
}

async function startSession(q, userId) {
  const token = randomBytes(32).toString('hex');
  await users.insertSession(q, userId, hashToken(token), sessionExpiry());
  return token;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    must_change_password: user.must_change_password,
  };
}

export async function register(body) {
  assertPasswordAllowed(body.password, body.email);
  const passwordHash = await hashPassword(body.password);
  try {
    return await withTx(async (client) => {
      const business = await users.insertBusiness(client, body.business_name);
      const user = await users.insertUser(client, {
        businessId: business.id,
        name: body.name,
        email: body.email,
        passwordHash,
        role: 'owner',
        mustChangePassword: false,
      });
      await insertAccount(client, business.id, { name: 'Kas', type: 'cash', opening_balance: 0 });
      await insertAccount(client, business.id, { name: 'Bank', type: 'bank', opening_balance: 0 });
      await insertDefaultCategories(client, business.id);
      await writeAudit(client, {
        businessId: business.id,
        userId: user.id,
        action: 'create',
        entityType: 'business',
        entityId: business.id,
        detail: { name: business.name },
      });
      const token = await startSession(client, user.id);
      return { token, user: publicUser(user) };
    });
  } catch (error) {
    return rethrowUnique(error, EMAIL_TAKEN);
  }
}

function remainingLockMinutes(lockedUntil) {
  return Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000);
}

async function recordFailure(user) {
  const lockExpired = user.locked_until && new Date(user.locked_until) <= new Date();
  const count = (lockExpired ? 0 : user.failed_login_count) + 1;
  const lockedUntil =
    count >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
  await withTx(async (client) => {
    await users.recordLoginFailure(client, user.id, count, lockedUntil);
    await writeAudit(client, {
      businessId: user.business_id,
      userId: user.id,
      action: 'login_failed',
      entityType: 'user',
      entityId: user.id,
    });
  });
  return lockedUntil;
}

function lockedError(minutes) {
  return new AppError(
    401,
    'ACCOUNT_LOCKED',
    `Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`,
  );
}

export async function login({ email, password }) {
  const user = await users.findUserByEmail(pool, email);
  if (!user || !user.is_active) throw unauthorized(WRONG_CREDENTIALS, 'WRONG_CREDENTIALS');

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw lockedError(remainingLockMinutes(user.locked_until));
  }

  if (!(await argon2.verify(user.password_hash, password))) {
    const lockedUntil = await recordFailure(user);
    if (lockedUntil) throw lockedError(LOCK_MINUTES);
    throw unauthorized(WRONG_CREDENTIALS, 'WRONG_CREDENTIALS');
  }

  return withTx(async (client) => {
    await users.recordLoginSuccess(client, user.id);
    await writeAudit(client, {
      businessId: user.business_id,
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
    });
    const token = await startSession(client, user.id);
    return { token, user: publicUser(user) };
  });
}

export async function logout(token) {
  await users.deleteSessionByHash(pool, hashToken(token));
}

export async function changePassword(actor, { current_password, new_password }) {
  const user = await users.findUserWithHash(pool, actor.id);
  if (!(await argon2.verify(user.password_hash, current_password))) {
    throw fieldError('current_password', 'Kata sandi saat ini salah.');
  }
  assertPasswordAllowed(new_password, user.email);
  const passwordHash = await hashPassword(new_password);
  await withTx(async (client) => {
    await users.setPassword(client, user.id, passwordHash, false);
    await users.deleteOtherSessions(client, user.id, actor.session_id);
    await writeAudit(client, {
      businessId: user.business_id,
      userId: user.id,
      action: 'update',
      entityType: 'user',
      entityId: user.id,
      detail: { password_changed: true },
    });
  });
}
