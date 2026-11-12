import { Router } from 'express';
import { z } from 'zod';
import { handle, pageResult } from '../lib/http.js';
import {
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
import { todayJakarta } from '../lib/dates.js';
import * as products from '../services/products.js';
import * as sales from '../services/sales.js';

export const productsRouter = Router();
export const salesRouter = Router();

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
  handle(async (req, res) =>
    res.json(await products.updateProduct(req.user, id(req), parse(updateProductSchema, req.body))),
  ),
);
productsRouter.post(
  '/:id/stock',
  handle(async (req, res) =>
    res.json(await products.changeStock(req.user, id(req), parse(stockSchema, req.body))),
  ),
);
productsRouter.get(
  '/:id/movements',
  handle(async (req, res) => {
    const query = parse(pageQuery, req.query);
    const { items, total } = await products.listMovements(req.user, id(req), query);
    res.json(pageResult(items, total, query));
  }),
);

/* Sales */
const saleSchema = z
  .object({
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
    account_id: nullableUuid,
    sale_date: notFarAhead.default(() => todayJakarta()),
  })
  .strict();
const saleListQuery = z.object({
  ...pagination,
  from: dateString.optional(),
  to: dateString.optional(),
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
  handle(async (req, res) => res.json(await sales.voidSale(req.user, id(req)))),
);
