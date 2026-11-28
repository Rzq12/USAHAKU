import { Router } from 'express';
import { z } from 'zod';
import { handle } from '../lib/http.js';
import { amount, dateString, EARLIEST_ENTRY_DATE, parse, uuid } from '../lib/schemas.js';
import * as assets from '../services/assets.js';

export const assetsRouter = Router();

const assetSchema = z.object({
  kind: z.enum(['fixed', 'prepaid']),
  group_name: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  acquired_on: dateString.refine(
    (value) => value >= EARLIEST_ENTRY_DATE,
    'Tanggal tidak boleh sebelum tahun 2000.',
  ),
  cost: amount,
  useful_life_months: z
    .number({ invalid_type_error: 'Masukkan jumlah bulan.' })
    .int('Masukkan jumlah bulan tanpa desimal.')
    .min(1, 'Minimal 1 bulan.')
    .max(1200, 'Maksimal 1200 bulan.'),
  expense_category_id: uuid,
  // Bought on or after the opening date: the cash account that paid, and the purchase category.
  paid_from_account_id: uuid.nullable().default(null),
  purchase_category_id: uuid.nullable().default(null),
});
const listQuery = z.object({ as_of: dateString.optional() });

assetsRouter.get(
  '/',
  handle(async (req, res) => {
    const { as_of } = parse(listQuery, req.query);
    res.json(await assets.listAssets(req.user, as_of));
  }),
);
assetsRouter.post(
  '/',
  handle(async (req, res) =>
    res.status(201).json(await assets.createAsset(req.user, parse(assetSchema, req.body))),
  ),
);
assetsRouter.put(
  '/:id',
  handle(async (req, res) =>
    res.json(
      await assets.updateAsset(req.user, parse(uuid, req.params.id), parse(assetSchema, req.body)),
    ),
  ),
);
assetsRouter.delete(
  '/:id',
  handle(async (req, res) => {
    await assets.deleteAsset(req.user, parse(uuid, req.params.id));
    res.status(204).end();
  }),
);
