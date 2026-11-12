import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { optionalText, parse } from '../lib/schemas.js';
import * as business from '../services/business.js';

export const businessRouter = Router();

const businessSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: optionalText(500),
  phone: optionalText(30),
  period_start_day: z
    .number()
    .int()
    .min(1, 'Tanggal awal periode harus antara 1 dan 28.')
    .max(28, 'Tanggal awal periode harus antara 1 dan 28.'),
});

businessRouter.get(
  '/',
  handle(async (req, res) => res.json(await business.getSettings(req.user))),
);
businessRouter.put(
  '/',
  handle(async (req, res) =>
    res.json(await business.updateSettings(req.user, parse(businessSchema, req.body))),
  ),
);
