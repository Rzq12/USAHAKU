import { pool, withTx } from '../db/pool.js';
import * as debts from '../db/debts.js';
import { getContact } from '../db/contacts.js';
import {
  insertTransaction,
  setTransactionSource,
  softDeleteTransaction,
} from '../db/transactions.js';
import { getSystemCategory } from '../db/categories.js';
import { getAccountBalance } from '../db/accounts.js';
import { setInvoiceStatusBySale } from '../db/invoices.js';
import { writeAudit } from '../db/audit.js';
import { conflict, fieldError, notFound, unprocessable } from '../lib/errors.js';
import { daysBetween, todayJakarta } from '../lib/dates.js';
import { formatRupiah } from '../lib/money.js';
import { requireActiveAccount } from './accounts.js';
import { requireActiveCategory } from './categories.js';

const STAFF_ROLE = 'staff';

/** BR-007: status from the amounts; Overdue is computed against today, never stored. */
export function debtStatus(amount, paidAmount) {
  if (paidAmount <= 0) return 'open';
  return paidAmount >= amount ? 'paid' : 'partial';
}

export function daysOverdue(debt, today) {
  if (!['open', 'partial'].includes(debt.status) || debt.due_date >= today) return 0;
  return daysBetween(debt.due_date, today);
}

function present(debt, today) {
  return { ...debt, days_overdue: daysOverdue(debt, today) };
}

export async function listDebts(actor, filters) {
  const today = todayJakarta();
  const type = actor.role === STAFF_ROLE ? 'receivable' : filters.type;
  return debts.listDebts(pool, actor.business_id, { ...filters, type, today });
}

async function requireVisibleDebt(q, actor, debtId) {
  const debt = await debts.getDebt(q, actor.business_id, debtId);
  if (!debt || (actor.role === STAFF_ROLE && debt.type !== 'receivable')) {
    throw notFound('Tagihan tidak ditemukan.');
  }
  return debt;
}

export async function getDebt(actor, debtId) {
  const debt = await requireVisibleDebt(pool, actor, debtId);
  const payments = await debts.listPayments(pool, actor.business_id, debtId);
  return { ...present(debt, todayJakarta()), payments };
}

export async function createDebt(actor, body) {
  return withTx(async (client) => {
    const contact = await getContact(client, actor.business_id, body.contact_id);
    if (!contact || contact.is_archived) throw fieldError('contact_id', 'Pilih kontak yang aktif.');
    if (body.type === 'payable') {
      if (!body.category_id) throw fieldError('category_id', 'Pilih kategori pengeluaran.');
      await requireActiveCategory(client, actor.business_id, body.category_id, 'expense');
    }
    const id = await debts.insertDebt(client, actor.business_id, {
      ...body,
      category_id: body.type === 'payable' ? body.category_id : null,
      source_type: 'manual',
      created_by: actor.id,
    });
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'debt',
      entityId: id,
      detail: { type: body.type, amount: body.amount, due_date: body.due_date },
    });
    return present(await debts.getDebt(client, actor.business_id, id), todayJakarta());
  });
}

async function paymentCategoryId(client, businessId, debt) {
  if (debt.type === 'payable') return debt.category_id;
  return (await getSystemCategory(client, businessId, 'sales')).id;
}

async function syncInvoice(client, businessId, debt, status) {
  if (debt.source_type !== 'sale') return;
  await setInvoiceStatusBySale(
    client,
    businessId,
    debt.source_id,
    status === 'paid' ? 'paid' : 'issued',
  );
}

/** BR-008: the payment moves cash through a transaction whose source type keeps it out of profit. */
export async function recordPayment(actor, debtId, body) {
  return withTx(async (client) => {
    const debt = await debts.lockDebt(client, actor.business_id, debtId);
    if (!debt || (actor.role === STAFF_ROLE && debt.type !== 'receivable')) {
      throw notFound('Tagihan tidak ditemukan.');
    }
    if (['paid', 'void'].includes(debt.status)) {
      throw conflict('Tagihan ini sudah lunas atau dibatalkan.', 'DEBT_CLOSED');
    }
    if (body.amount > debt.remaining) {
      throw unprocessable(
        `Pembayaran melebihi sisa tagihan (${formatRupiah(debt.remaining)}).`,
        'OVERPAYMENT',
      );
    }
    if (body.paid_on < debt.issue_date) {
      throw fieldError('paid_on', 'Tanggal bayar tidak boleh sebelum tanggal tagihan.');
    }
    await requireActiveAccount(client, actor.business_id, body.account_id);

    const isReceivable = debt.type === 'receivable';
    const transactionId = await insertTransaction(client, {
      businessId: actor.business_id,
      account_id: body.account_id,
      type: isReceivable ? 'income' : 'expense',
      amount: body.amount,
      category_id: await paymentCategoryId(client, actor.business_id, debt),
      contact_id: debt.contact_id,
      occurred_on: body.paid_on,
      note: `Pembayaran ${isReceivable ? 'piutang' : 'hutang'} ${debt.contact_name}`,
      source_type: isReceivable ? 'receivable_payment' : 'payable_payment',
      created_by: actor.id,
    });
    const paymentId = await debts.insertPayment(client, actor.business_id, {
      debt_id: debtId,
      transaction_id: transactionId,
      amount: body.amount,
      paid_on: body.paid_on,
      created_by: actor.id,
    });
    await setTransactionSource(client, actor.business_id, transactionId, paymentId);

    const paidAmount = debt.paid_amount + body.amount;
    const status = debtStatus(debt.amount, paidAmount);
    await debts.setDebtPaid(client, actor.business_id, debtId, paidAmount, status);
    await syncInvoice(client, actor.business_id, debt, status);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'debt_payment',
      entityId: paymentId,
      detail: { debt_id: debtId, amount: body.amount, status: { old: debt.status, new: status } },
    });

    const result = {
      debt: present(await debts.getDebt(client, actor.business_id, debtId), todayJakarta()),
    };
    if (actor.role !== STAFF_ROLE) {
      result.account_balance = await getAccountBalance(client, actor.business_id, body.account_id);
    }
    return result;
  });
}

export async function voidPayment(actor, debtId, paymentId) {
  return withTx(async (client) => {
    const debt = await debts.lockDebt(client, actor.business_id, debtId);
    if (!debt) throw notFound('Tagihan tidak ditemukan.');
    const payment = await debts.getPayment(client, actor.business_id, debtId, paymentId);
    if (!payment) throw notFound('Pembayaran tidak ditemukan.');
    if (payment.is_void) throw conflict('Pembayaran ini sudah dibatalkan.', 'ALREADY_VOID');
    if (debt.status === 'void') throw conflict('Tagihan ini sudah dibatalkan.', 'DEBT_CLOSED');

    await debts.markPaymentVoid(client, actor.business_id, paymentId);
    await softDeleteTransaction(client, actor.business_id, payment.transaction_id);

    const paidAmount = debt.paid_amount - payment.amount;
    const status = debtStatus(debt.amount, paidAmount);
    await debts.setDebtPaid(client, actor.business_id, debtId, paidAmount, status);
    await syncInvoice(client, actor.business_id, debt, status);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'void',
      entityType: 'debt_payment',
      entityId: paymentId,
      detail: { debt_id: debtId, amount: payment.amount },
    });
    return present(await debts.getDebt(client, actor.business_id, debtId), todayJakarta());
  });
}
