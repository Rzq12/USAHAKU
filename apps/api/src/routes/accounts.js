import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { MAX_AMOUNT, parse, queryBoolean, uuid } from '../lib/schemas.js';
import { OWNER, requireRole } from '../middleware/auth.js';
import * as accounts from '../services/accounts.js';

export const accountsRouter = Router();

const accountSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(['cash', 'bank', 'ewallet']),
  opening_balance: z
    .number({ invalid_type_error: 'Masukkan angka rupiah tanpa desimal.' })
    .int('Masukkan angka rupiah tanpa desimal.')
    .min(-MAX_AMOUNT)
    .max(MAX_AMOUNT),
});
const listQuery = z.object({ include_archived: queryBoolean.default('false') });
const archiveSchema = z.object({ is_archived: z.boolean().default(true) });

accountsRouter.get(
  '/',
  handle(async (req, res) => {
    const { include_archived } = parse(listQuery, req.query);
    res.json(await accounts.listAccounts(req.user, include_archived));
  }),
);
accountsRouter.post(
  '/',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.status(201).json(await accounts.createAccount(req.user, parse(accountSchema, req.body))),
  ),
);
accountsRouter.put(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(
      await accounts.updateAccount(req.user, parse(uuid, req.params.id), parse(accountSchema, req.body)),
    ),
  ),
);
accountsRouter.post(
  '/:id/archive',
  requireRole(OWNER),
  handle(async (req, res) => {
    const { is_archived } = parse(archiveSchema, req.body ?? {});
    res.json(await accounts.archiveAccount(req.user, parse(uuid, req.params.id), is_archived));
  }),
);
accountsRouter.delete(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) => {
    await accounts.deleteAccount(req.user, parse(uuid, req.params.id));
    res.status(204).end();
  }),
);
