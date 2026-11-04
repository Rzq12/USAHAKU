import { pool, withTx } from '../db/pool.js';
import * as contacts from '../db/contacts.js';
import { hasOpenDebts } from '../db/debts.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { conflict, notFound } from '../lib/errors.js';

const OPEN_DEBTS = 'Kontak masih punya hutang atau piutang yang belum lunas.';

function forRole(contact, role) {
  if (role !== 'staff') return contact;
  const { payable_balance: _payable, ...visible } = contact;
  return visible;
}

export async function listContacts(actor, filters) {
  const { items, total } = await contacts.listContacts(pool, actor.business_id, filters);
  return { items: items.map((c) => forRole(c, actor.role)), total };
}

export async function createContact(actor, body) {
  return withTx(async (client) => {
    const id = await contacts.insertContact(client, actor.business_id, body);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'contact',
      entityId: id,
      detail: { name: body.name, type: body.type },
    });
    return forRole(await contacts.getContact(client, actor.business_id, id), actor.role);
  });
}

export async function updateContact(actor, contactId, body) {
  return withTx(async (client) => {
    const before = await contacts.getContact(client, actor.business_id, contactId);
    if (!before) throw notFound('Kontak tidak ditemukan.');
    if (body.is_archived && (await hasOpenDebts(client, actor.business_id, contactId))) {
      throw conflict(OPEN_DEBTS, 'CONTACT_HAS_OPEN_DEBTS');
    }
    await contacts.updateContact(client, actor.business_id, contactId, { ...before, ...body });
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'contact',
      entityId: contactId,
      detail: changedFields(before, body),
    });
    return contacts.getContact(client, actor.business_id, contactId);
  });
}
