import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { nonNegativeAmount, optionalText, parse, uuid } from '../lib/schemas.js';
import { ACCOUNTANT, OWNER, requireRole } from '../middleware/auth.js';
import * as users from '../services/users.js';
import * as business from '../services/business.js';

export const usersRouter = Router();
export const businessRouter = Router();

usersRouter.use(requireRole(OWNER));

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  role: z.enum(['staff', 'accountant']),
  temporary_password: z.string().min(8).max(200),
});
const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    role: z.enum(['owner', 'staff', 'accountant']),
    is_active: z.boolean(),
  })
  .partial();
const resetSchema = z.object({ temporary_password: z.string().min(8).max(200) });

usersRouter.get(
  '/',
  handle(async (req, res) => res.json({ items: await users.listUsers(req.user) })),
);
usersRouter.post(
  '/',
  handle(async (req, res) =>
    res.status(201).json(await users.createUser(req.user, parse(createUserSchema, req.body))),
  ),
);
usersRouter.put(
  '/:id',
  handle(async (req, res) =>
    res.json(
      await users.updateUser(
        req.user,
        parse(uuid, req.params.id),
        parse(updateUserSchema, req.body),
      ),
    ),
  ),
);
usersRouter.post(
  '/:id/reset-password',
  handle(async (req, res) => {
    const { temporary_password } = parse(resetSchema, req.body);
    await users.resetPassword(req.user, parse(uuid, req.params.id), temporary_password);
    res.status(204).end();
  }),
);

const businessSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: optionalText(500),
  phone: optionalText(30),
  npwp: optionalText(25).refine(
    (value) => value === null || [15, 16].includes(value.replace(/[^0-9]/g, '').length),
    'NPWP harus 15 atau 16 digit.',
  ),
  taxpayer_type: z.enum(['individual', 'company']),
  period_start_day: z
    .number()
    .int()
    .min(1, 'Tanggal awal periode harus antara 1 dan 28.')
    .max(28, 'Tanggal awal periode harus antara 1 dan 28.'),
  tax_rate: z
    .number()
    .min(0)
    .max(5, 'Tarif pajak maksimal 5 persen.')
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      'Maksimal 2 desimal.',
    ),
  tax_threshold: nonNegativeAmount,
  payment_info: optionalText(1000),
});

businessRouter.get(
  '/',
  requireRole(OWNER, ACCOUNTANT),
  handle(async (req, res) => res.json(await business.getSettings(req.user))),
);
businessRouter.put(
  '/',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(await business.updateSettings(req.user, parse(businessSchema, req.body))),
  ),
);
