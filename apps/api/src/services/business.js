import { pool, withTx } from '../db/pool.js';
import { getBusiness, updateBusiness } from '../db/business.js';
import { changedFields, writeAudit } from '../db/audit.js';

export async function getSettings(actor) {
  return getBusiness(pool, actor.business_id);
}

export async function updateSettings(actor, body) {
  return withTx(async (client) => {
    const before = await getBusiness(client, actor.business_id);
    const after = await updateBusiness(client, actor.business_id, body);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'business',
      entityId: actor.business_id,
      detail: changedFields(before, body),
    });
    return after;
  });
}
