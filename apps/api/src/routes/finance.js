import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError, notFound, tooManyRequests } from '../lib/errors.js';
import { handle, sendFile } from '../lib/http.js';
import { dateRangeQuery, dateString, parse, queryBoolean, uuid } from '../lib/schemas.js';
import { daysBetween } from '../lib/dates.js';
import * as dashboard from '../services/dashboard.js';
import * as reports from '../services/reports.js';
import { buildDataExport } from '../services/dataExport.js';

export const dashboardRouter = Router();
export const reportsRouter = Router();
export const exportRouter = Router();

/*
 * Businesses with a file build still running. The slot is released when the build itself ends,
 * not when the request times out, so repeated requests cannot pile work onto the shared process.
 */
const exportsRunning = new Set();
const EXPORT_BUSY = 'Ekspor sebelumnya masih berjalan. Tunggu sebentar, lalu coba lagi.';

/** Runs one file build per business and fails a slow one with the retry message. */
function runExport(actor, build, message) {
  if (exportsRunning.has(actor.business_id)) {
    return Promise.reject(tooManyRequests(EXPORT_BUSY, 30));
  }
  exportsRunning.add(actor.business_id);
  const work = Promise.resolve()
    .then(build)
    .finally(() => exportsRunning.delete(actor.business_id));
  // The build keeps running after a timeout; this stops its later rejection going unhandled.
  work.catch(() => {});
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError(422, 'EXPORT_TIMEOUT', message)),
      config.exportTimeoutMs,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** A removed or unknown report is a missing address, like any other removed route. */
function reportNameOf(req) {
  const name = req.params.name;
  if (!Object.hasOwn(reports.REPORTS, name)) throw notFound('Laporan tidak ditemukan.');
  return name;
}

/* Dashboard */
dashboardRouter.get(
  '/',
  handle(async (req, res) => res.json(await dashboard.getDashboard(req.user))),
);

/* Reports */
const MAX_RANGE_DAYS = 5 * 366;
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

// Registered before '/:name/export' so the package path is not read as a report name.
const packageQuery = z
  .object({ from: dateString, to: dateString, format: z.enum(['xlsx', 'pdf']) })
  .and(rangeFields);
reportsRouter.get(
  '/financial-statements/export',
  handle(async (req, res) => {
    const query = parse(packageQuery, req.query);
    const file = await runExport(
      req.user,
      () => reports.exportFinancialStatements(req.user, query),
      'Ekspor terlalu lama. Persempit rentang tanggal.',
    );
    sendFile(res, file);
  }),
);
reportsRouter.get(
  '/:name/export',
  handle(async (req, res) => {
    const name = reportNameOf(req);
    const query = parse(exportQuery, req.query);
    const file = await runExport(
      req.user,
      () => reports.exportReport(req.user, name, query),
      'Ekspor terlalu lama. Persempit rentang tanggal.',
    );
    sendFile(res, file);
  }),
);
reportsRouter.get(
  '/:name',
  handle(async (req, res) => {
    const name = reportNameOf(req);
    res.json(await reports.runReport(req.user, name, parse(reportQuery, req.query)));
  }),
);

/* Full data export */
const optionalRange = z.object({ from: dateString.optional(), to: dateString.optional() });
exportRouter.get(
  '/data',
  handle(async (req, res) => {
    const range = parse(optionalRange, req.query);
    const file = await runExport(
      req.user,
      () => buildDataExport(req.user, range),
      'Ekspor terlalu lama. Coba lagi dengan rentang tanggal lebih kecil.',
    );
    sendFile(res, file);
  }),
);
