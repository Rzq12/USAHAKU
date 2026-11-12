import { pool, withTx } from '../db/pool.js';
import * as accounts from '../db/accounts.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { conflict, fieldError, notFound, rethrowUnique } from '../lib/errors.js';

const NAME_TAKEN = {
  accounts_business_id_name_key: { field: 'name', message: 'Nama akun sudah dipakai.' },
};
const HAS_TRANSACTIONS = 'Akun sudah punya transaksi. Arsipkan saja.';

/** BR-011: Staff never receive balances. */
export async function listAccounts(actor, includeArchived) {
  const items = await accounts.listAccounts(pool, actor.business_id, includeArchived);
  const totalBalance = items
    .filter((account) => !account.is_archived)
    .reduce((sum, account) => sum + account.balance, 0);
  return { items, total_balance: totalBalance };
}

export async function createAccount(actor, body) {
  try {
    return await withTx(async (client) => {
      const id = await accounts.insertAccount(client, actor.business_id, body);
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: 'create',
        entityType: 'account',
        entityId: id,
        detail: body,
      });
      return accounts.getAccount(client, actor.business_id, id);
    });
  } catch (error) {
    return rethrowUnique(error, NAME_TAKEN);
  }
}

async function requireAccount(client, businessId, accountId) {
  const account = await accounts.getAccount(client, businessId, accountId);
  if (!account) throw notFound('Akun tidak ditemukan.');
  return account;
}

export async function updateAccount(actor, accountId, body) {
  try {
    return await withTx(async (client) => {
      const before = await requireAccount(client, actor.business_id, accountId);
      await accounts.updateAccount(client, actor.business_id, accountId, body);
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: 'update',
        entityType: 'account',
        entityId: accountId,
        detail: changedFields(before, body),
      });
      return accounts.getAccount(client, actor.business_id, accountId);
    });
  } catch (error) {
    return rethrowUnique(error, NAME_TAKEN);
  }
}

export async function archiveAccount(actor, accountId, isArchived) {
  return withTx(async (client) => {
    await requireAccount(client, actor.business_id, accountId);
    await accounts.setAccountArchived(client, actor.business_id, accountId, isArchived);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'account',
      entityId: accountId,
      detail: { is_archived: { new: isArchived } },
    });
    return accounts.getAccount(client, actor.business_id, accountId);
  });
}

export async function deleteAccount(actor, accountId) {
  await withTx(async (client) => {
    await requireAccount(client, actor.business_id, accountId);
    if (await accounts.accountHasHistory(client, actor.business_id, accountId)) {
      throw conflict(HAS_TRANSACTIONS, 'ACCOUNT_HAS_TRANSACTIONS');
    }
    await accounts.deleteAccount(client, actor.business_id, accountId);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'delete',
      entityType: 'account',
      entityId: accountId,
    });
  });
}

/** An account a new record may point at. */
export async function requireActiveAccount(client, businessId, accountId, field = 'account_id') {
  const account = await accounts.getAccount(client, businessId, accountId);
  if (!account || account.is_archived) throw fieldError(field, 'Pilih akun yang masih aktif.');
  return account;
}
