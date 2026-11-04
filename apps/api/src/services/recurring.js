import { pool, withTx } from '../db/pool.js';
import * as recurring from '../db/recurring.js';
import { getAccount } from '../db/accounts.js';
import { getCategory } from '../db/categories.js';
import { insertTransaction } from '../db/transactions.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { fieldError, notFound, unprocessable } from '../lib/errors.js';
import { addDays, addMonthsClamped, monthsBetween, todayJakarta } from '../lib/dates.js';
import { requireActiveAccount } from './accounts.js';
import { requireActiveCategory } from './categories.js';

const ARCHIVED_ACCOUNT = 'Akun pada aturan ini sudah diarsipkan. Ganti akunnya.';
const ARCHIVED_CATEGORY = 'Kategori pada aturan ini sudah diarsipkan. Ganti kategorinya.';

/** Monthly dates come from the start date, so 31 Jan gives 28 Feb and then 31 Mar. */
export function nextOccurrence(rule, current) {
  if (rule.frequency === 'daily') return addDays(current, 1);
  if (rule.frequency === 'weekly') return addDays(current, 7);
  return addMonthsClamped(rule.start_on, monthsBetween(rule.start_on, current) + 1);
}

export const listRules = (actor) => recurring.listRules(pool, actor.business_id);

export async function createRule(actor, body) {
  return withTx(async (client) => {
    await requireActiveAccount(client, actor.business_id, body.account_id);
    await requireActiveCategory(client, actor.business_id, body.category_id, body.type);
    const id = await recurring.insertRule(client, actor.business_id, body);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'recurring_rule',
      entityId: id,
      detail: { amount: body.amount, frequency: body.frequency, start_on: body.start_on },
    });
    return recurring.getRule(client, actor.business_id, id);
  });
}

/** Resuming a rule skips the paused dates instead of posting them all. */
function firstOccurrenceFrom(rule, today) {
  let date = rule.next_run_on;
  while (date < today) date = nextOccurrence(rule, date);
  return date;
}

export async function updateRule(actor, ruleId, body) {
  return withTx(async (client) => {
    const before = await recurring.getRule(client, actor.business_id, ruleId);
    if (!before) throw notFound('Aturan tidak ditemukan.');
    const next = { ...before, ...body };
    if (next.end_on && next.end_on <= next.start_on) {
      throw fieldError('end_on', 'Tanggal akhir harus setelah tanggal mulai.');
    }
    if (body.account_id) await requireActiveAccount(client, actor.business_id, body.account_id);
    if (body.category_id) {
      await requireActiveCategory(client, actor.business_id, body.category_id, before.type);
    }
    if (!before.is_active && next.is_active) {
      next.next_run_on = firstOccurrenceFrom(before, todayJakarta());
    }
    await recurring.updateRule(client, actor.business_id, ruleId, next);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'recurring_rule',
      entityId: ruleId,
      detail: changedFields(before, body),
    });
    return recurring.getRule(client, actor.business_id, ruleId);
  });
}

async function postOccurrence(client, rule, date, userId) {
  const account = await getAccount(client, rule.business_id, rule.account_id);
  if (!account || account.is_archived) throw unprocessable(ARCHIVED_ACCOUNT, 'ACCOUNT_ARCHIVED');
  const category = await getCategory(client, rule.business_id, rule.category_id);
  if (!category || category.is_archived)
    throw unprocessable(ARCHIVED_CATEGORY, 'CATEGORY_ARCHIVED');

  const transactionId = await insertTransaction(client, {
    businessId: rule.business_id,
    account_id: rule.account_id,
    type: rule.type,
    amount: rule.amount,
    category_id: rule.category_id,
    occurred_on: date,
    note: rule.note,
    source_type: 'recurring',
    source_id: rule.id,
    created_by: userId,
  });
  const nextRunOn = nextOccurrence(rule, date);
  const stillActive = !rule.end_on || nextRunOn <= rule.end_on;
  await recurring.advanceRule(client, rule.id, {
    next_run_on: nextRunOn,
    is_active: stillActive,
    last_run_on: date,
  });
  await writeAudit(client, {
    businessId: rule.business_id,
    userId,
    action: 'create',
    entityType: 'transaction',
    entityId: transactionId,
    detail: { recurring_rule_id: rule.id, occurred_on: date, amount: rule.amount },
  });
  return { transactionId, nextRunOn, stillActive };
}

export async function runRuleNow(actor, ruleId) {
  return withTx(async (client) => {
    const rule = await recurring.getRule(client, actor.business_id, ruleId);
    if (!rule) throw notFound('Aturan tidak ditemukan.');
    if (!rule.is_active) throw unprocessable('Aturan ini tidak aktif.', 'RULE_INACTIVE');
    await postOccurrence(client, rule, rule.next_run_on, actor.id);
    return recurring.getRule(client, actor.business_id, ruleId);
  });
}

async function recordFailure(rule, message) {
  await withTx(async (client) => {
    await recurring.recordRuleError(client, rule.id, message.slice(0, 200));
    await writeAudit(client, {
      businessId: rule.business_id,
      action: 'recurring_failed',
      entityType: 'recurring_rule',
      entityId: rule.id,
      detail: { reason: message },
    });
  });
}

/** Posts every missed date of a rule, one database transaction per date. */
async function runRule(rule, today) {
  let current = { ...rule };
  let posted = 0;
  while (current.is_active && current.next_run_on <= today) {
    const date = current.next_run_on;
    const { nextRunOn, stillActive } = await withTx((client) =>
      postOccurrence(client, current, date, null),
    );
    current = { ...current, next_run_on: nextRunOn, is_active: stillActive };
    posted += 1;
  }
  return posted;
}

/** Daily job. A failing rule is recorded and retried next run; the others are not affected. */
export async function runDueRules(today = todayJakarta()) {
  const rules = await recurring.listDueRules(pool, today);
  let posted = 0;
  let failed = 0;
  for (const rule of rules) {
    try {
      posted += await runRule(rule, today);
    } catch (error) {
      failed += 1;
      await recordFailure(rule, error.message);
    }
  }
  return { posted, failed };
}
