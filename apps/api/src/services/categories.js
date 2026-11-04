import { pool, withTx } from '../db/pool.js';
import * as categories from '../db/categories.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { conflict, fieldError, notFound, rethrowUnique } from '../lib/errors.js';

const NAME_TAKEN = {
  categories_unique_name: { field: 'name', message: 'Nama kategori sudah dipakai.' },
};
const IN_USE = 'Kategori sudah dipakai. Arsipkan saja.';

export async function listCategories(actor, includeArchived) {
  return { items: await categories.listCategories(pool, actor.business_id, includeArchived) };
}

export async function createCategory(actor, body) {
  if (body.type === 'expense' && !body.pl_group) {
    throw fieldError('pl_group', 'Pilih kelompok laba rugi.');
  }
  const fields = { ...body, pl_group: body.type === 'expense' ? body.pl_group : null };
  try {
    return await withTx(async (client) => {
      if (fields.parent_id) {
        const parent = await categories.getCategory(client, actor.business_id, fields.parent_id);
        if (!parent || parent.parent_id || parent.type !== fields.type) {
          throw fieldError('parent_id', 'Induk harus kategori utama dengan jenis yang sama.');
        }
      }
      const category = await categories.insertCategory(client, actor.business_id, fields);
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: 'create',
        entityType: 'category',
        entityId: category.id,
        detail: fields,
      });
      return category;
    });
  } catch (error) {
    return rethrowUnique(error, NAME_TAKEN);
  }
}

export async function updateCategory(actor, categoryId, body) {
  try {
    return await withTx(async (client) => {
      const before = await categories.getCategory(client, actor.business_id, categoryId);
      if (!before) throw notFound('Kategori tidak ditemukan.');
      const next = { ...before, ...body };
      if (before.system_key && next.is_archived) {
        throw conflict('Kategori bawaan sistem tidak dapat diarsipkan.');
      }
      if (before.type === 'income') next.pl_group = null;
      const category = await categories.updateCategory(client, actor.business_id, categoryId, next);
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: 'update',
        entityType: 'category',
        entityId: categoryId,
        detail: changedFields(before, body),
      });
      return category;
    });
  } catch (error) {
    return rethrowUnique(error, NAME_TAKEN);
  }
}

export async function deleteCategory(actor, categoryId) {
  await withTx(async (client) => {
    const category = await categories.getCategory(client, actor.business_id, categoryId);
    if (!category) throw notFound('Kategori tidak ditemukan.');
    if (
      category.system_key ||
      (await categories.categoryHasHistory(client, actor.business_id, categoryId))
    ) {
      throw conflict(IN_USE, 'CATEGORY_IN_USE');
    }
    await categories.deleteCategory(client, actor.business_id, categoryId);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'delete',
      entityType: 'category',
      entityId: categoryId,
      detail: { name: category.name },
    });
  });
}

/** A category of the right type that a new record may point at. */
export async function requireActiveCategory(client, businessId, categoryId, type) {
  const category = await categories.getCategory(client, businessId, categoryId);
  if (!category || category.is_archived || category.type !== type) {
    throw fieldError('category_id', 'Pilih kategori aktif dengan jenis yang sesuai.');
  }
  return category;
}

export async function listRules(actor) {
  return { items: await categories.listRules(pool, actor.business_id) };
}

async function requireRuleTarget(client, businessId, categoryId) {
  const category = await categories.getCategory(client, businessId, categoryId);
  if (!category || category.is_archived) {
    throw fieldError('category_id', 'Aturan harus menuju kategori yang masih aktif.');
  }
}

export async function createRule(actor, body) {
  const rule = { ...body, keyword: body.keyword.toLowerCase() };
  return withTx(async (client) => {
    await requireRuleTarget(client, actor.business_id, rule.category_id);
    const created = await categories.insertRule(client, actor.business_id, rule);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'category_rule',
      entityId: created.id,
      detail: rule,
    });
    return created;
  });
}

export async function updateRule(actor, ruleId, body) {
  const rule = { ...body, keyword: body.keyword.toLowerCase() };
  return withTx(async (client) => {
    const before = await categories.getRule(client, actor.business_id, ruleId);
    if (!before) throw notFound('Aturan tidak ditemukan.');
    await requireRuleTarget(client, actor.business_id, rule.category_id);
    const updated = await categories.updateRule(client, actor.business_id, ruleId, rule);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'category_rule',
      entityId: ruleId,
      detail: changedFields(before, rule),
    });
    return updated;
  });
}

export async function deleteRule(actor, ruleId) {
  await withTx(async (client) => {
    const before = await categories.getRule(client, actor.business_id, ruleId);
    if (!before) throw notFound('Aturan tidak ditemukan.');
    await categories.deleteRule(client, actor.business_id, ruleId);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'delete',
      entityType: 'category_rule',
      entityId: ruleId,
      detail: { keyword: before.keyword },
    });
  });
}

export async function testRule(actor, { note, type }) {
  const match = await categories.matchRule(pool, actor.business_id, note, type);
  return { matched_category: match?.category_id ?? null, category_name: match?.category_name ?? null };
}

export async function listTags(actor) {
  return { items: await categories.listTags(pool, actor.business_id) };
}
