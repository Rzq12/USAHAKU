import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/*
 * PostgreSQL foreign-key and numeric-range violations come from values the caller sent.
 * CHECK violations stay server errors: input checks run first, so one means a code fault.
 */
const CLIENT_DB_ERRORS = new Set(['23503', '22003']);

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

/**
 * Headers for every API response, so they hold even without the Caddy front door:
 * no MIME sniffing of receipts, no framing, and no caching of business data on shared devices.
 */
export function apiSecurityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Second CSRF layer next to the SameSite cookie: a header a cross-site form cannot set. */
export function requireCsrfHeader(req, _res, next) {
  if (SAFE_METHODS.has(req.method) || req.get('X-Usahaku-Client') === 'web') return next();
  next(new AppError(403, 'CSRF', 'Permintaan ditolak.'));
}

const LIMITER_PRUNE_SIZE = 10_000;

export function perMinuteLimiter(limit) {
  const hits = new Map();
  return function isAllowed(key, now = Date.now()) {
    const minute = Math.floor(now / 60_000);
    const entry = hits.get(key);
    if (!entry || entry.minute !== minute) {
      // Drop only counters from earlier minutes, so a flood of new keys never resets live ones.
      if (hits.size > LIMITER_PRUNE_SIZE) {
        for (const [oldKey, old] of hits) if (old.minute !== minute) hits.delete(oldKey);
      }
      hits.set(key, { minute, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

/** Seconds until the current one-minute window ends, for a Retry-After header. */
export function secondsToNextMinute(now = Date.now()) {
  return Math.max(1, Math.ceil((60_000 - (now % 60_000)) / 1000));
}

export function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Alamat tidak ditemukan.'));
}

export function errorHandler(error, req, res, _next) {
  if (error instanceof AppError) {
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, fields: error.fields },
    });
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Data yang dikirim tidak valid.' } });
  }
  // A reference or rule the request broke: the caller can fix it, so it is not a server fault.
  if (CLIENT_DB_ERRORS.has(error.code)) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Data yang dipilih tidak valid. Periksa isian.' },
    });
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
