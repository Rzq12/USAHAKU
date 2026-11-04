import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { handle, pageResult, sendFile } from '../lib/http.js';
import {
  amount,
  dateString,
  nonNegativeAmount,
  notFarAhead,
  optionalText,
  pagination,
  parse,
  quantity,
  queryBoolean,
  uuid,
} from '../lib/schemas.js';
import { OWNER, STAFF, ACCOUNTANT, requireRole } from '../middleware/auth.js';
import { todayJakarta } from '../lib/dates.js';
import * as products from '../services/products.js';
import * as sales from '../services/sales.js';
import * as contacts from '../services/contacts.js';
import * as debts from '../services/debts.js';
import * as invoices from '../services/invoices.js';

export const productsRouter = Router();
export const salesRouter = Router();
export const contactsRouter = Router();
export const debtsRouter = Router();
export const invoicesRouter = Router();

const id = (req) => parse(uuid, req.params.id);
const nullableUuid = uuid.nullish().transform((value) => value ?? null);

/* Products */
const nonNegativeQty = quantity.refine((value) => value >= 0, 'Tidak boleh kurang dari 0.');
const positiveQty = quantity.refine((value) => value > 0, 'Harus lebih dari 0.');
const productFields = {
  sku: optionalText(40),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(20),
  sell_price: nonNegativeAmount,
  cost_price: nonNegativeAmount,
  track_stock: z.boolean(),
  low_stock_threshold: nonNegativeQty.nullish().transform((value) => value ?? null),
};
const createProductSchema = z.object({
  ...productFields,
  opening_stock: nonNegativeQty.default(0),
});
const updateProductSchema = z.object({ ...productFields, is_active: z.boolean() }).partial();
const stockSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('restock'),
      qty: positiveQty,
      cost_price: nonNegativeAmount.optional(),
      record_expense: z.boolean().default(false),
      account_id: uuid.optional(),
    }),
    z.object({
      kind: z.literal('adjustment'),
      qty_delta: quantity.refine((value) => value !== 0, 'Tidak boleh 0.'),
      reason: z.string().trim().min(3).max(200),
    }),
  ])
  .refine((body) => !body.record_expense || body.account_id, {
    path: ['account_id'],
    message: 'Pilih akun untuk mencatat pengeluaran.',
  });
const productListQuery = z.object({
  ...pagination,
  q: z.string().max(120).optional(),
  include_inactive: queryBoolean.default('false'),
  low_stock: queryBoolean.default('false'),
});
const pageQuery = z.object(pagination);

productsRouter.get(
  '/',
  handle(async (req, res) => {
    const query = parse(productListQuery, req.query);
    const { items, total } = await products.listProducts(req.user, query);
    res.json(pageResult(items, total, query));
  }),
);
productsRouter.post(
  '/',
  requireRole(OWNER),
  handle(async (req, res) =>
    res
      .status(201)
      .json(await products.createProduct(req.user, parse(createProductSchema, req.body))),
  ),
);
productsRouter.get(
  '/:id',
  handle(async (req, res) => res.json(await products.getProduct(req.user, id(req)))),
);
productsRouter.put(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(await products.updateProduct(req.user, id(req), parse(updateProductSchema, req.body))),
  ),
);
productsRouter.post(
  '/:id/stock',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(await products.changeStock(req.user, id(req), parse(stockSchema, req.body))),
  ),
);
productsRouter.get(
  '/:id/movements',
  requireRole(OWNER, ACCOUNTANT),
  handle(async (req, res) => {
    const query = parse(pageQuery, req.query);
    const { items, total } = await products.listMovements(req.user, id(req), query);
    res.json(pageResult(items, total, query));
  }),
);

/* Sales */
const saleSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: nullableUuid,
        description: optionalText(120),
        qty: positiveQty,
        unit_price: nonNegativeAmount,
      }),
    )
    .min(1)
    .max(100),
  discount: nonNegativeAmount.default(0),
  payment_type: z.enum(['paid', 'credit']),
  account_id: nullableUuid,
  contact_id: nullableUuid,
  due_date: dateString.nullish().transform((value) => value ?? null),
  sale_date: notFarAhead.default(() => todayJakarta()),
});
const saleListQuery = z.object({
  ...pagination,
  from: dateString.optional(),
  to: dateString.optional(),
  contact_id: uuid.optional(),
  payment_status: z.enum(['paid', 'open', 'partial', 'void']).optional(),
});

salesRouter.get(
  '/',
  handle(async (req, res) => {
    const query = parse(saleListQuery, req.query);
    const { items, total } = await sales.listSales(req.user, query);
    res.json(pageResult(items, total, query));
  }),
);
salesRouter.post(
  '/',
  requireRole(OWNER, STAFF),
  handle(async (req, res) =>
    res.status(201).json(await sales.createSale(req.user, parse(saleSchema, req.body))),
  ),
);
salesRouter.get(
  '/:id',
  handle(async (req, res) => res.json(await sales.getSale(req.user, id(req)))),
);
salesRouter.post(
  '/:id/void',
  requireRole(OWNER),
  handle(async (req, res) => res.json(await sales.voidSale(req.user, id(req)))),
);

/* Contacts */
const contactFields = {
  name: z.string().trim().min(1).max(120),
  type: z.enum(['customer', 'supplier', 'both']),
  phone: optionalText(30).refine(
    (value) => value === null || /^[0-9 +-]+$/.test(value),
    'Hanya angka, spasi, + dan -.',
  ),
  email: z
    .union([z.literal(''), z.string().trim().toLowerCase().email().max(255)])
    .nullish()
    .transform((value) => value || null),
  address: optionalText(500),
  notes: optionalText(1000),
};
const contactSchema = z.object(contactFields);
const updateContactSchema = z.object({ ...contactFields, is_archived: z.boolean() }).partial();
const contactListQuery = z.object({
  ...pagination,
  q: z.string().max(120).optional(),
  type: z.enum(['customer', 'supplier']).optional(),
  include_archived: queryBoolean.default('false'),
});

contactsRouter.get(
  '/',
  handle(async (req, res) => {
    const query = parse(contactListQuery, req.query);
    const { items, total } = await contacts.listContacts(req.user, query);
    res.json(pageResult(items, total, query));
  }),
);
contactsRouter.post(
  '/',
  requireRole(OWNER, STAFF),
  handle(async (req, res) =>
    res.status(201).json(await contacts.createContact(req.user, parse(contactSchema, req.body))),
  ),
);
contactsRouter.put(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(await contacts.updateContact(req.user, id(req), parse(updateContactSchema, req.body))),
  ),
);

/* Receivables and payables */
const debtSchema = z
  .object({
    type: z.enum(['receivable', 'payable']),
    contact_id: uuid,
    amount,
    issue_date: dateString,
    due_date: dateString,
    category_id: nullableUuid,
    note: optionalText(500),
  })
  .refine((body) => body.due_date >= body.issue_date, {
    path: ['due_date'],
    message: 'Jatuh tempo tidak boleh sebelum tanggal tagihan.',
  });
const paymentSchema = z.object({
  amount,
  account_id: uuid,
  paid_on: notFarAhead,
});
const debtListQuery = z.object({
  ...pagination,
  type: z.enum(['receivable', 'payable']).optional(),
  status: z.enum(['open', 'partial', 'paid', 'void', 'overdue', 'unpaid']).optional(),
  contact_id: uuid.optional(),
});

debtsRouter.get(
  '/',
  handle(async (req, res) => {
    const query = parse(debtListQuery, req.query);
    const { items, total, remaining } = await debts.listDebts(req.user, query);
    res.json(pageResult(items, total, query, { remaining }));
  }),
);
debtsRouter.post(
  '/',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.status(201).json(await debts.createDebt(req.user, parse(debtSchema, req.body))),
  ),
);
debtsRouter.get(
  '/:id',
  handle(async (req, res) => res.json(await debts.getDebt(req.user, id(req)))),
);
debtsRouter.post(
  '/:id/payments',
  requireRole(OWNER, STAFF),
  handle(async (req, res) =>
    res
      .status(201)
      .json(await debts.recordPayment(req.user, id(req), parse(paymentSchema, req.body))),
  ),
);
debtsRouter.post(
  '/:id/payments/:paymentId/void',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(await debts.voidPayment(req.user, id(req), parse(uuid, req.params.paymentId))),
  ),
);

/* Invoices */
const invoiceSchema = z.object({
  sale_id: uuid,
  issue_date: dateString,
  due_date: dateString.nullish().transform((value) => value ?? null),
  notes: optionalText(500),
});
const updateInvoiceSchema = z
  .object({
    issue_date: dateString,
    due_date: dateString.nullable(),
    notes: optionalText(500),
    status: z.literal('void'),
  })
  .partial();
const invoiceListQuery = z.object({
  ...pagination,
  status: z.enum(['draft', 'issued', 'paid', 'void']).optional(),
});

invoicesRouter.get(
  '/',
  handle(async (req, res) => {
    const query = parse(invoiceListQuery, req.query);
    const { items, total } = await invoices.listInvoices(req.user, query);
    res.json(pageResult(items, total, query));
  }),
);
invoicesRouter.post(
  '/',
  requireRole(OWNER, STAFF),
  handle(async (req, res) =>
    res.status(201).json(await invoices.createInvoice(req.user, parse(invoiceSchema, req.body))),
  ),
);
invoicesRouter.get(
  '/:id',
  handle(async (req, res) => res.json(await invoices.getInvoice(req.user, id(req)))),
);
invoicesRouter.put(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(await invoices.updateInvoice(req.user, id(req), parse(updateInvoiceSchema, req.body))),
  ),
);
invoicesRouter.get(
  '/:id/pdf',
  handle(async (req, res) => {
    try {
      sendFile(res, await invoices.buildInvoicePdf(req.user, id(req)));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        500,
        'PDF_FAILED',
        'PDF gagal dibuat. Faktur tetap tersimpan, coba unduh lagi.',
      );
    }
  }),
);
