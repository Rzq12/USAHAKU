import { pool, withTx } from '../db/pool.js';
import { getBusiness, updateBusiness } from '../db/business.js';
import { changedFields, writeAudit } from '../db/audit.js';

function present(business) {
  const { tax_rate_bp, ...rest } = business;
  return { ...rest, tax_rate: tax_rate_bp / 100 };
}

export async function getSettings(actor) {
  return present(await getBusiness(pool, actor.business_id));
}

export async function updateSettings(actor, body) {
  const { tax_rate, ...rest } = body;
  const fields = { ...rest, tax_rate_bp: Math.round(tax_rate * 100) };
  return withTx(async (client) => {
    const before = await getBusiness(client, actor.business_id);
    const after = await updateBusiness(client, actor.business_id, fields);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'business',
      entityId: actor.business_id,
      detail: changedFields(before, fields),
    });
    return present(after);
  });
}
