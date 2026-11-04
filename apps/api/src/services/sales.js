import { pool, withTx } from '../db/pool.js';
import * as sales from '../db/sales.js';
import * as debts from '../db/debts.js';
import { lockProducts, listSaleMovements, writeStockMovement } from '../db/products.js';
import { insertTransaction, softDeleteBySource } from '../db/transactions.js';
import { getSystemCategory } from '../db/categories.js';
import { getContact } from '../db/contacts.js';
import { setInvoiceStatusBySale } from '../db/invoices.js';
import { writeAudit } from '../db/audit.js';
import { conflict, fieldError, notFound, unprocessable } from '../lib/errors.js';
import { formatQty, lineAmount } from '../lib/money.js';
import { requireActiveAccount } from './accounts.js';

const STAFF_ROLE = 'staff';

function assertPaymentFields(body) {
  if (body.payment_type === 'paid') {
    if (!body.account_id) throw fieldError('account_id', 'Pilih akun penerima.');
    return;
  }
  if (!body.contact_id) throw fieldError('contact_id', 'Pilih pelanggan untuk penjualan kredit.');
  if (!body.due_date) throw fieldError('due_date', 'Isi tanggal jatuh tempo.');
  if (body.due_date < body.sale_date) {
    throw fieldError('due_date', 'Jatuh tempo tidak boleh sebelum tanggal penjualan.');
  }
}

async function requireCustomer(client, businessId, contactId) {
  const contact = await getContact(client, businessId, contactId);
  if (!contact || contact.is_archived || contact.type === 'supplier') {
    throw fieldError('contact_id', 'Pilih pelanggan yang masih aktif.');
  }
}

/** Prices each line, reduces stock for tracked products, and returns what to store. */
async function buildLines(client, actor, body) {
  const productIds = [...new Set(body.items.map((item) => item.product_id).filter(Boolean))];
  const locked = await lockProducts(client, actor.business_id, productIds);
  const byId = new Map(locked.map((product) => [product.id, product]));

  const lines = [];
  for (const [index, item] of body.items.entries()) {
    if (!item.product_id) {
      if (!item.description) throw fieldError(`items.${index}.description`, 'Isi nama barang.');
      lines.push({ ...item, unit_cost: 0, product_id: null });
      continue;
    }
    const product = byId.get(item.product_id);
    if (!product || !product.is_active) {
      throw fieldError(`items.${index}.product_id`, 'Produk tidak aktif.');
    }
    if (product.track_stock) {
      if (Math.round(item.qty * 1000) > Math.round(product.stock_qty * 1000)) {
        throw unprocessable(
          `Stok ${product.name} hanya ${formatQty(product.stock_qty)} ${product.unit}.`,
          'INSUFFICIENT_STOCK',
        );
      }
      product.stock_qty = Math.round((product.stock_qty - item.qty) * 1000) / 1000;
    }
    lines.push({
      ...item,
      description: item.description || product.name,
      unit_cost: product.cost_price,
      product,
    });
  }

  return lines.map((line) => ({
    ...line,
    line_total: lineAmount(line.qty, line.unit_price),
    line_cost: lineAmount(line.qty, line.unit_cost),
  }));
}

function lowStockWarnings(lines) {
  const seen = new Map();
  for (const { product } of lines) {
    if (!product?.track_stock || product.low_stock_threshold === null) continue;
    if (product.stock_qty <= product.low_stock_threshold) seen.set(product.id, product);
  }
  return [...seen.values()].map(
    (product) => `Stok ${product.name} tinggal ${formatQty(product.stock_qty)} ${product.unit}.`,
  );
}

async function storeSale(client, actor, body, lines, totals) {
  const saleId = await sales.insertSale(client, actor.business_id, {
    contact_id: body.contact_id,
    sale_date: body.sale_date,
    ...totals,
    payment_type: body.payment_type,
    account_id: body.payment_type === 'paid' ? body.account_id : null,
    created_by: actor.id,
  });
  for (const line of lines) {
    await sales.insertSaleItem(client, actor.business_id, saleId, {
      ...line,
      product_id: line.product?.id ?? null,
    });
    if (line.product?.track_stock) {
      await writeStockMovement(client, {
        businessId: actor.business_id,
        productId: line.product.id,
        type: 'sale',
        qty: -line.qty,
        refId: saleId,
        userId: actor.id,
      });
    }
  }
  return saleId;
}

async function recordSettlement(client, actor, body, saleId, total) {
  if (body.payment_type === 'credit') {
    const debtId = await debts.insertDebt(client, actor.business_id, {
      type: 'receivable',
      contact_id: body.contact_id,
      source_type: 'sale',
      source_id: saleId,
      issue_date: body.sale_date,
      due_date: body.due_date,
      amount: total,
      created_by: actor.id,
    });
    return { debt_id: debtId };
  }
  if (total === 0) return {};
  const category = await getSystemCategory(client, actor.business_id, 'sales');
  const transactionId = await insertTransaction(client, {
    businessId: actor.business_id,
    account_id: body.account_id,
    type: 'income',
    amount: total,
    category_id: category.id,
    contact_id: body.contact_id,
    occurred_on: body.sale_date,
    source_type: 'sale',
    source_id: saleId,
    created_by: actor.id,
  });
  return { transaction_id: transactionId };
}

export async function createSale(actor, body) {
  assertPaymentFields(body);
  return withTx(async (client) => {
    if (body.payment_type === 'paid') {
      await requireActiveAccount(client, actor.business_id, body.account_id);
    }
    if (body.contact_id) await requireCustomer(client, actor.business_id, body.contact_id);

    const lines = await buildLines(client, actor, body);
    const subtotal = lines.reduce((sum, line) => sum + line.line_total, 0);
    if (body.discount > subtotal) throw fieldError('discount', 'Diskon melebihi subtotal.');
    const total = subtotal - body.discount;
    if (body.payment_type === 'credit' && total === 0) {
      throw fieldError('payment_type', 'Penjualan kredit harus punya total lebih dari 0.');
    }

    const saleId = await storeSale(client, actor, body, lines, {
      subtotal,
      discount: body.discount,
      total,
    });
    const settlement = await recordSettlement(client, actor, body, saleId, total);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'create',
      entityType: 'sale',
      entityId: saleId,
      detail: { total, payment_type: body.payment_type, lines: lines.length },
    });
    const sale = await loadSale(client, actor, saleId);
    return { sale, ...settlement, stock_warnings: lowStockWarnings(lines) };
  });
}

function itemForRole(item, role) {
  if (role !== STAFF_ROLE) return item;
  const visible = { ...item };
  delete visible.unit_cost;
  delete visible.line_cost;
  return visible;
}

async function loadSale(q, actor, saleId) {
  const sale = await sales.getSale(q, actor.business_id, saleId);
  if (!sale || (actor.role === STAFF_ROLE && sale.created_by !== actor.id)) {
    throw notFound('Penjualan tidak ditemukan.');
  }
  const items = await sales.listSaleItems(q, actor.business_id, saleId);
  const debtId = await debts.findDebtBySale(q, actor.business_id, saleId);
  return { ...sale, debt_id: debtId ?? null, items: items.map((i) => itemForRole(i, actor.role)) };
}

export const getSale = (actor, saleId) => loadSale(pool, actor, saleId);

export async function listSales(actor, filters) {
  const scoped = actor.role === STAFF_ROLE ? { ...filters, created_by: actor.id } : filters;
  return sales.listSales(pool, actor.business_id, scoped);
}

async function voidReceivable(client, businessId, saleId) {
  const debtId = await debts.findDebtBySale(client, businessId, saleId);
  if (!debtId) return;
  const payments = await debts.listActivePayments(client, businessId, debtId);
  for (const payment of payments) {
    await debts.markPaymentVoid(client, businessId, payment.id);
    await softDeleteBySource(client, businessId, 'receivable_payment', payment.id);
  }
  await debts.setDebtPaid(client, businessId, debtId, 0, 'void');
}

/** BR-005: reverses stock, the income transaction or receivable, and the invoice in one unit. */
export async function voidSale(actor, saleId) {
  return withTx(async (client) => {
    const sale = await sales.lockSale(client, actor.business_id, saleId);
    if (!sale) throw notFound('Penjualan tidak ditemukan.');
    if (sale.status === 'void') throw conflict('Penjualan ini sudah dibatalkan.', 'ALREADY_VOID');

    const movements = await listSaleMovements(client, actor.business_id, saleId);
    const productIds = [...new Set(movements.map((movement) => movement.product_id))];
    await lockProducts(client, actor.business_id, productIds);
    for (const movement of movements) {
      await writeStockMovement(client, {
        businessId: actor.business_id,
        productId: movement.product_id,
        type: 'void',
        qty: -movement.qty,
        refId: saleId,
        userId: actor.id,
      });
    }

    await softDeleteBySource(client, actor.business_id, 'sale', saleId);
    await voidReceivable(client, actor.business_id, saleId);
    await setInvoiceStatusBySale(client, actor.business_id, saleId, 'void');
    await sales.markSaleVoid(client, actor.business_id, saleId);
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'void',
      entityType: 'sale',
      entityId: saleId,
      detail: { total: sale.total },
    });
    return loadSale(client, actor, saleId);
  });
}
