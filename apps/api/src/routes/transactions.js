import { Router } from 'express';
import { z } from 'zod';
import { handle, pageResult, uploadSingle } from '../lib/http.js';
import { amount, dateString, notFarAhead, optionalText, pagination, parse, uuid } from '../lib/schemas.js';
import { OWNER, STAFF, requireRole } from '../middleware/auth.js';
import * as transactions from '../services/transactions.js';

export const transactionsRouter = Router();

const nullableUuid = uuid.nullish().transform((value) => value ?? null);
const tags = z.array(z.string().trim().min(1).max(30)).max(10).default([]);

const baseFields = {
  amount,
  account_id: uuid,
  transfer_account_id: nullableUuid,
  category_id: nullableUuid,
  contact_id: nullableUuid,
  occurred_on: notFarAhead,
  note: optionalText(500),
  tags,
};
const createSchema = z.object({ ...baseFields, type: z.enum(['income', 'expense', 'transfer']) });
const updateSchema = z.object({ ...baseFields, is_excluded: z.boolean().optional() });
const listQuery = z.object({
  ...pagination,
  from: dateString.optional(),
  to: dateString.optional(),
  account_id: uuid.optional(),
  type: z.enum(['income', 'expense', 'transfer']).optional(),
  category_id: uuid.optional(),
  tag: z.string().max(30).optional(),
  q: z.string().max(200).optional(),
});

transactionsRouter.get(
  '/',
  handle(async (req, res) => {
    const query = parse(listQuery, req.query);
    const { items, total, totals } = await transactions.listTransactions(req.user, query);
    res.json(pageResult(items, total, query, { totals }));
  }),
);
transactionsRouter.post(
  '/',
  requireRole(OWNER, STAFF),
  handle(async (req, res) =>
    res.status(201).json(await transactions.createTransaction(req.user, parse(createSchema, req.body))),
  ),
);
transactionsRouter.get(
  '/:id',
  handle(async (req, res) =>
    res.json(await transactions.getTransaction(req.user, parse(uuid, req.params.id))),
  ),
);
transactionsRouter.put(
  '/:id',
  requireRole(OWNER, STAFF),
  handle(async (req, res) =>
    res.json(
      await transactions.updateTransaction(
        req.user,
        parse(uuid, req.params.id),
        parse(updateSchema, req.body),
      ),
    ),
  ),
);
transactionsRouter.delete(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) => {
    await transactions.deleteTransaction(req.user, parse(uuid, req.params.id));
    res.status(204).end();
  }),
);
transactionsRouter.post(
  '/:id/receipt',
  requireRole(OWNER, STAFF),
  uploadSingle('receipt', 'Foto melebihi 5 MB.'),
  handle(async (req, res) =>
    res.json(await transactions.attachReceipt(req.user, parse(uuid, req.params.id), req.file)),
  ),
);
transactionsRouter.get(
  '/:id/receipt',
  handle(async (req, res) => {
    const receipt = await transactions.getReceipt(req.user, parse(uuid, req.params.id));
    res.type(receipt.mimeType).sendFile(receipt.absolutePath);
  }),
);
