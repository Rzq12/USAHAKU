import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { handle, sendFile } from '../lib/http.js';
import { dateRangeQuery, dateString, parse, queryBoolean, uuid } from '../lib/schemas.js';
import { daysBetween } from '../lib/dates.js';
import * as dashboard from '../services/dashboard.js';
import * as reports from '../services/reports.js';
import { buildDataExport } from '../services/dataExport.js';

export const dashboardRouter = Router();
export const reportsRouter = Router();
export const exportRouter = Router();

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

/* Dashboard */
dashboardRouter.get(
  '/',
  handle(async (req, res) => res.json(await dashboard.getDashboard(req.user))),
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

/* Full data export */
const optionalRange = z.object({ from: dateString.optional(), to: dateString.optional() });
exportRouter.get(
  '/data',
  handle(async (req, res) => {
    const file = await withExportTimeout(
      buildDataExport(req.user, parse(optionalRange, req.query)),
      'Ekspor terlalu lama. Coba lagi dengan rentang tanggal lebih kecil.',
    );
    sendFile(res, file);
  }),
);
