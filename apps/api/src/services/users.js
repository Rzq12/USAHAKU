import { pool, withTx } from '../db/pool.js';
import * as users from '../db/users.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { conflict, notFound, rethrowUnique } from '../lib/errors.js';
import { assertPasswordAllowed, hashPassword } from './auth.js';

const EMAIL_TAKEN = {
  users_email_key: { field: 'email', message: 'Email sudah terdaftar.' },
};
const LAST_OWNER = 'Pemilik terakhir tidak dapat dinonaktifkan.';

export const listUsers = (actor) => users.listUsers(pool, actor.business_id);

export async function createUser(actor, body) {
  assertPasswordAllowed(body.temporary_password, body.email);
  const passwordHash = await hashPassword(body.temporary_password);
  try {
    return await withTx(async (client) => {
      const user = await users.insertUser(client, {
        businessId: actor.business_id,
        name: body.name,
        email: body.email,
        passwordHash,
        role: body.role,
        mustChangePassword: true,
      });
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        detail: { name: user.name, email: user.email, role: user.role },
      });
      return user;
    });
  } catch (error) {
    return rethrowUnique(error, EMAIL_TAKEN);
  }
}

export async function updateUser(actor, userId, body) {
  return withTx(async (client) => {
    const before = await users.findUser(client, actor.business_id, userId);
    if (!before) throw notFound();
    const next = { ...before, ...body };

    const losesOwnerAccess = before.role === 'owner' && (next.role !== 'owner' || !next.is_active);
    if (losesOwnerAccess && (await users.countActiveOwners(client, actor.business_id)) <= 1) {
      throw conflict(LAST_OWNER, 'LAST_OWNER');
    }

    const user = await users.updateUserFields(client, actor.business_id, userId, next);
    if (!user.is_active) await users.deleteUserSessions(client, userId);

    const changes = changedFields(before, {
      name: user.name,
      role: user.role,
      is_active: user.is_active,
    });
    if (Object.keys(changes).length > 0) {
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: changes.role ? 'role_change' : 'update',
        entityType: 'user',
        entityId: userId,
        detail: changes,
      });
    }
    return user;
  });
}

export async function resetPassword(actor, userId, temporaryPassword) {
  const target = await users.findUser(pool, actor.business_id, userId);
  if (!target) throw notFound();
  assertPasswordAllowed(temporaryPassword, target.email);
  const passwordHash = await hashPassword(temporaryPassword);
  await withTx(async (client) => {
    await users.setPassword(client, userId, passwordHash, true);
    await users.deleteUserSessions(client, userId);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'user',
      entityId: userId,
      detail: { password_reset: true },
    });
  });
}
