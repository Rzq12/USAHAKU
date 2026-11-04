import { pool, withTx } from '../db/pool.js';
import * as invoices from '../db/invoices.js';
import * as sales from '../db/sales.js';
import { getBusiness } from '../db/business.js';
import { getContact } from '../db/contacts.js';
import { getDebt, findDebtBySale } from '../db/debts.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { conflict, fieldError, notFound, unprocessable } from '../lib/errors.js';
import { invoicePdf } from '../lib/pdf.js';

const ALREADY_EXISTS = 'Penjualan ini sudah punya faktur.';
const NO_ADDRESS = 'Lengkapi alamat usaha di Pengaturan sebelum membuat faktur.';

async function initialStatus(client, businessId, sale) {
  if (sale.payment_type === 'paid') return 'paid';
  const debtId = await findDebtBySale(client, businessId, sale.id);
  const debt = await getDebt(client, businessId, debtId);
  return debt.status === 'paid' ? 'paid' : 'issued';
}

export async function createInvoice(actor, body) {
  if (body.due_date && body.due_date < body.issue_date) {
    throw fieldError('due_date', 'Jatuh tempo tidak boleh sebelum tanggal faktur.');
  }
  return withTx(async (client) => {
    const business = await getBusiness(client, actor.business_id);
    if (!business.address) throw unprocessable(NO_ADDRESS, 'BUSINESS_ADDRESS_MISSING');

    const sale = await sales.lockSale(client, actor.business_id, body.sale_id);
    if (!sale) throw notFound('Penjualan tidak ditemukan.');
    if (actor.role === 'staff' && sale.created_by !== actor.id) {
      throw notFound('Penjualan tidak ditemukan.');
    }
    if (sale.status === 'void') throw conflict('Penjualan ini sudah dibatalkan.', 'SALE_VOID');
    if (await invoices.findInvoiceBySale(client, actor.business_id, body.sale_id)) {
      throw conflict(ALREADY_EXISTS, 'INVOICE_EXISTS');
    }

    const year = Number(body.issue_date.slice(0, 4));
    const number = await invoices.nextInvoiceNumber(client, actor.business_id, year);
    const id = await invoices.insertInvoice(client, actor.business_id, {
      ...body,
      number,
      status: await initialStatus(client, actor.business_id, sale),
      created_by: actor.id,
    });
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'invoice',
      entityId: id,
      detail: { number, sale_id: body.sale_id },
    });
    return invoices.getInvoice(client, actor.business_id, id);
  });
}

export const listInvoices = (actor, filters) =>
  invoices.listInvoices(pool, actor.business_id, filters);

async function requireInvoice(q, businessId, invoiceId) {
  const invoice = await invoices.getInvoice(q, businessId, invoiceId);
  if (!invoice) throw notFound('Faktur tidak ditemukan.');
  return invoice;
}

export const getInvoice = (actor, invoiceId) => requireInvoice(pool, actor.business_id, invoiceId);

export async function updateInvoice(actor, invoiceId, body) {
  return withTx(async (client) => {
    const before = await requireInvoice(client, actor.business_id, invoiceId);
    if (before.status === 'void') throw conflict('Faktur ini sudah dibatalkan.', 'INVOICE_VOID');

    if (body.status === 'void') {
      await invoices.updateInvoice(client, actor.business_id, invoiceId, {
        ...before,
        status: 'void',
      });
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: 'void',
        entityType: 'invoice',
        entityId: invoiceId,
        detail: { number: before.number },
      });
      return requireInvoice(client, actor.business_id, invoiceId);
    }

    if (before.status !== 'issued') {
      throw conflict('Hanya faktur yang belum lunas yang dapat diubah.', 'INVOICE_NOT_EDITABLE');
    }
    const next = { ...before, ...body };
    if (next.due_date && next.due_date < next.issue_date) {
      throw fieldError('due_date', 'Jatuh tempo tidak boleh sebelum tanggal faktur.');
    }
    await invoices.updateInvoice(client, actor.business_id, invoiceId, next);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'invoice',
      entityId: invoiceId,
      detail: changedFields(before, body),
    });
    return requireInvoice(client, actor.business_id, invoiceId);
  });
}

export async function buildInvoicePdf(actor, invoiceId) {
  const invoice = await requireInvoice(pool, actor.business_id, invoiceId);
  const sale = await sales.getSale(pool, actor.business_id, invoice.sale_id);
  const items = await sales.listSaleItems(pool, actor.business_id, invoice.sale_id);
  const business = await getBusiness(pool, actor.business_id);
  const customer = sale.contact_id
    ? await getContact(pool, actor.business_id, sale.contact_id)
    : null;
  const buffer = await invoicePdf({ invoice, sale, items, business, customer });
  return {
    buffer,
    contentType: 'application/pdf',
    filename: `${invoice.number.replaceAll('/', '-')}.pdf`,
  };
}
