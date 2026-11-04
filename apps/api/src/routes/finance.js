import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { handle, pageResult, sendFile, uploadSingle } from '../lib/http.js';
import {
  amount,
  dateRangeQuery,
  dateString,
  notFarAhead,
  optionalText,
  pagination,
  parse,
  queryBoolean,
  uuid,
} from '../lib/schemas.js';
import { ACCOUNTANT, OWNER, requireRole } from '../middleware/auth.js';
import { daysBetween, todayJakarta } from '../lib/dates.js';
import { pool } from '../db/pool.js';
import { listAuditLogs } from '../db/audit.js';
import * as budgets from '../services/budgets.js';
import * as recurring from '../services/recurring.js';
import * as dashboard from '../services/dashboard.js';
import * as reports from '../services/reports.js';
import * as tax from '../services/tax.js';
import * as imports from '../services/imports.js';
import { buildDataExport } from '../services/dataExport.js';

export const budgetsRouter = Router();
export const recurringRouter = Router();
export const dashboardRouter = Router();
export const reportsRouter = Router();
export const taxRouter = Router();
export const importRouter = Router();
export const exportRouter = Router();
export const auditRouter = Router();

const id = (req) => parse(uuid, req.params.id);

/** Fails a slow file build with the retry message from the functional requirements. */
function withExportTimeout(promise, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError(422, 'EXPORT_TIMEOUT', message)),
      config.exportTimeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* Budgets */
const budgetSchema = z.object({
  period: dateString,
  items: z.array(z.object({ category_id: uuid, amount })).max(100),
});
budgetsRouter.get(
  '/summary',
  requireRole(OWNER, ACCOUNTANT),
  handle(async (req, res) => {
    const { period } = parse(z.object({ period: dateString.optional() }), req.query);
    res.json(await budgets.budgetSummary(req.user, period));
  }),
);
budgetsRouter.put(
  '/',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(await budgets.saveBudget(req.user, parse(budgetSchema, req.body))),
  ),
);

/* Recurring */
const recurringSchema = z
  .object({
    type: z.enum(['income', 'expense']),
    account_id: uuid,
    category_id: uuid,
    amount,
    note: optionalText(500),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    start_on: dateString,
    end_on: dateString.nullish().transform((value) => value ?? null),
  })
  .refine((body) => !body.end_on || body.end_on > body.start_on, {
    path: ['end_on'],
    message: 'Tanggal akhir harus setelah tanggal mulai.',
  });
const updateRecurringSchema = z
  .object({
    account_id: uuid,
    category_id: uuid,
    amount,
    note: optionalText(500),
    end_on: dateString.nullable(),
    is_active: z.boolean(),
  })
  .partial();

recurringRouter.get(
  '/',
  requireRole(OWNER, ACCOUNTANT),
  handle(async (req, res) => res.json({ items: await recurring.listRules(req.user) })),
);
recurringRouter.post(
  '/',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.status(201).json(await recurring.createRule(req.user, parse(recurringSchema, req.body))),
  ),
);
recurringRouter.put(
  '/:id',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.json(await recurring.updateRule(req.user, id(req), parse(updateRecurringSchema, req.body))),
  ),
);
recurringRouter.post(
  '/:id/run',
  requireRole(OWNER),
  handle(async (req, res) => res.json(await recurring.runRuleNow(req.user, id(req)))),
);

/* Dashboard */
dashboardRouter.get(
  '/',
  handle(async (req, res) => {
    const { period } = parse(
      z.object({ period: z.enum(['current', 'previous']).default('current') }),
      req.query,
    );
    res.json(await dashboard.getDashboard(req.user, period));
  }),
);

/* Reports */
const MAX_RANGE_DAYS = 5 * 366;
const reportName = z.enum(Object.keys(reports.REPORTS));
const rangeFields = dateRangeQuery.refine(
  (range) => daysBetween(range.from, range.to) <= MAX_RANGE_DAYS,
  {
    path: ['to'],
    message: 'Rentang tanggal paling lama 5 tahun.',
  },
);
const reportQuery = z
  .object({
    from: dateString,
    to: dateString,
    compare: queryBoolean.default('false'),
    account_id: uuid.optional(),
  })
  .and(rangeFields);
const exportQuery = reportQuery.and(z.object({ format: z.enum(['csv', 'xlsx', 'pdf']) }));

reportsRouter.use(requireRole(OWNER, ACCOUNTANT));
reportsRouter.get(
  '/:name/export',
  handle(async (req, res) => {
    const name = parse(reportName, req.params.name);
    const file = await withExportTimeout(
      reports.exportReport(req.user, name, parse(exportQuery, req.query)),
      'Ekspor terlalu lama. Persempit rentang tanggal.',
    );
    sendFile(res, file);
  }),
);
reportsRouter.get(
  '/:name',
  handle(async (req, res) => {
    const name = parse(reportName, req.params.name);
    res.json(await reports.runReport(req.user, name, parse(reportQuery, req.query)));
  }),
);

/* Tax */
taxRouter.get(
  '/estimate',
  requireRole(OWNER, ACCOUNTANT),
  handle(async (req, res) => {
    const currentYear = Number(todayJakarta().slice(0, 4));
    const { year } = parse(
      z.object({ year: z.coerce.number().int().min(2020).max(currentYear) }),
      req.query,
    );
    res.json(await tax.estimateTax(req.user, year));
  }),
);
const taxPaymentSchema = z.object({
  year: z.number().int().min(2020),
  month: z.number().int().min(1).max(12),
  amount,
  account_id: uuid,
  paid_on: notFarAhead,
});
taxRouter.post(
  '/record-payment',
  requireRole(OWNER),
  handle(async (req, res) =>
    res.status(201).json(await tax.recordTaxPayment(req.user, parse(taxPaymentSchema, req.body))),
  ),
);

/* Import */
const columnIndex = z.coerce.number().int().min(0);
const mappingSchema = z.object({
  date: columnIndex,
  amount: columnIndex,
  type: columnIndex.optional(),
  note: columnIndex.optional(),
  category: columnIndex.optional(),
});
const jsonField = (schema) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = schema.safeParse(JSON.parse(value));
      if (parsed.success) return parsed.data;
    } catch {
      /* reported below */
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Pemetaan kolom tidak valid.' });
    return z.NEVER;
  });
const importFields = {
  mapping: jsonField(mappingSchema),
  account_id: uuid,
  default_category_id: uuid,
  default_income_category_id: z
    .union([z.literal(''), uuid])
    .optional()
    .transform((value) => value || null),
};
const previewSchema = z.union([
  z.object(importFields),
  z.object({}).transform(() => ({ mapping: null })),
]);
const commitSchema = z.object({
  ...importFields,
  include_duplicates: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
const importUpload = uploadSingle('file', 'File melebihi 5 MB.');

importRouter.use(requireRole(OWNER));
importRouter.post(
  '/preview',
  importUpload,
  handle(async (req, res) =>
    res.json(await imports.previewImport(req.user, req.file, parse(previewSchema, req.body))),
  ),
);
importRouter.post(
  '/commit',
  importUpload,
  handle(async (req, res) =>
    res.json(await imports.commitImport(req.user, req.file, parse(commitSchema, req.body))),
  ),
);

/* Full data export */
const optionalRange = z.object({ from: dateString.optional(), to: dateString.optional() });
exportRouter.get(
  '/data',
  requireRole(OWNER, ACCOUNTANT),
  handle(async (req, res) => {
    const file = await withExportTimeout(
      buildDataExport(req.user, parse(optionalRange, req.query)),
      'Ekspor terlalu lama. Coba lagi dengan rentang tanggal lebih kecil.',
    );
    sendFile(res, file);
  }),
);

/* Audit log */
const auditQuery = z.object({
  ...pagination,
  user_id: uuid.optional(),
  entity_type: z.string().max(30).optional(),
  action: z.string().max(30).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});
auditRouter.get(
  '/',
  requireRole(OWNER, ACCOUNTANT),
  handle(async (req, res) => {
    const query = parse(auditQuery, req.query);
    const { items, total } = await listAuditLogs(pool, req.user.business_id, query);
    res.json(pageResult(items, total, query));
  }),
);
