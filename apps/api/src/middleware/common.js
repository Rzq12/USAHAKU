import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Structured request log with a request id and no personal data. */
export function requestLog(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  if (!config.logRequests) return next();
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(
      JSON.stringify({
        level: 'info',
        request_id: req.id,
        method: req.method,
        path: req.route ? `${req.baseUrl}${req.route.path}` : req.baseUrl,
        status: res.statusCode,
        ms: Date.now() - startedAt,
      }),
    );
  });
  next();
}

/** Second CSRF layer next to the SameSite cookie: a header a cross-site form cannot set. */
export function requireCsrfHeader(req, _res, next) {
  if (SAFE_METHODS.has(req.method) || req.get('X-Usahaku-Client') === 'web') return next();
  next(new AppError(403, 'CSRF', 'Permintaan ditolak.'));
}

export function perMinuteLimiter(limit) {
  const hits = new Map();
  return function isAllowed(key, now = Date.now()) {
    const minute = Math.floor(now / 60_000);
    const entry = hits.get(key);
    if (!entry || entry.minute !== minute) {
      if (hits.size > 10_000) hits.clear();
      hits.set(key, { minute, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

export function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Alamat tidak ditemukan.'));
}

export function errorHandler(error, req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, fields: error.fields },
    });
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Data yang dikirim tidak valid.' } });
  }
  console.error(
    JSON.stringify({
      level: 'error',
      request_id: req.id,
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    }),
  );
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan di server. Coba lagi.' },
  });
}
