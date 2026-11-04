import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { parse, queryBoolean, uuid } from '../lib/schemas.js';
import { ACCOUNTANT, OWNER, STAFF, requireRole } from '../middleware/auth.js';
import * as categories from '../services/categories.js';

export const categoriesRouter = Router();
export const rulesRouter = Router();
export const tagsRouter = Router();

const plGroup = z.enum(['operating_expense', 'other_expense', 'inventory']);
const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(['income', 'expense']),
  parent_id: uuid.nullish().transform((value) => value ?? null),
  pl_group: plGroup.nullish().transform((value) => value ?? null),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    pl_group: plGroup,
    is_archived: z.boolean(),
  })
  .partial();
const listQuery = z.object({ include_archived: queryBoolean.default('false') });

categoriesRouter.get(
  '/',
  handle(async (req, res) => {
    const { include_archived } = parse(listQuery, req.query);
    res.json(await categories.listCategories(req.user, include_archived));
  }),
);
categoriesRouter.post(
  '/',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.status(201).json(await categories.createCategory(req.user, parse(createSchema, req.body))),
  ),
);
categoriesRouter.put(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(
      await categories.updateCategory(
        req.user,
        parse(uuid, req.params.id),
        parse(updateSchema, req.body),
      ),
    ),
  ),
);
categoriesRouter.delete(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) => {
    await categories.deleteCategory(req.user, parse(uuid, req.params.id));
    res.status(204).end();
  }),
);

const ruleSchema = z.object({
  keyword: z.string().trim().min(2).max(50),
  category_id: uuid,
  priority: z.number().int().min(1).max(100),
});
const testSchema = z.object({
  note: z.string().max(500),
  type: z.enum(['income', 'expense']).optional(),
});

rulesRouter.get(
  '/',
  requireRole(OWNER, ACCOUNTANT),
  handle(async (req, res) => res.json(await categories.listRules(req.user))),
);
rulesRouter.post(
  '/test',
  requireRole(OWNER, STAFF),
  handle(async (req, res) =>
    res.json(await categories.testRule(req.user, parse(testSchema, req.body))),
  ),
);
rulesRouter.post(
  '/',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.status(201).json(await categories.createRule(req.user, parse(ruleSchema, req.body))),
  ),
);
rulesRouter.put(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(
      await categories.updateRule(
        req.user,
        parse(uuid, req.params.id),
        parse(ruleSchema, req.body),
      ),
    ),
  ),
);
rulesRouter.delete(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) => {
    await categories.deleteRule(req.user, parse(uuid, req.params.id));
    res.status(204).end();
  }),
);

tagsRouter.get(
  '/',
  handle(async (req, res) => res.json(await categories.listTags(req.user))),
);
