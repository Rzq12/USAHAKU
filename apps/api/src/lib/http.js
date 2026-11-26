import multer from 'multer';
import { AppError, fieldError } from './errors.js';

export const handle = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function pageResult(items, total, { page, limit }, extra = {}) {
  return { items, total, page, limit, ...extra };
}

const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const IDEMPOTENCY_MAX_ENTRIES = 5_000;
const IN_FLIGHT = 'Permintaan yang sama sedang diproses. Tunggu sebentar.';

/**
 * Replays the first answer when a client resends a create with the same Idempotency-Key, so a
 * retried request after a dropped connection does not record the same sale or expense twice.
 * Keys are scoped to the business. Memory only: the app runs as one process (see README).
 */
export function idempotent() {
  const seen = new Map();
  return (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 100) return next();
    const now = Date.now();
    for (const [storedKey, entry] of seen) {
      if (now - entry.at > IDEMPOTENCY_TTL_MS || seen.size > IDEMPOTENCY_MAX_ENTRIES) {
        seen.delete(storedKey);
      } else break;
    }
    const scoped = `${req.user.business_id}:${req.baseUrl}${req.path}:${key}`;
    const stored = seen.get(scoped);
    if (stored?.body) return res.status(stored.status).json(stored.body);
    if (stored) return next(new AppError(409, 'IN_PROGRESS', IN_FLIGHT));

    const entry = { at: now };
    seen.set(scoped, entry);
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 300) Object.assign(entry, { status: res.statusCode, body });
      else seen.delete(scoped);
      return json(body);
    };
    res.on('close', () => {
      if (!entry.body) seen.delete(scoped);
    });
    return next();
  };
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function uploadSingle(fieldName, tooLargeMessage) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  }).single(fieldName);
  return (req, res, next) =>
    upload(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') return next(fieldError(fieldName, tooLargeMessage));
      return next(new AppError(400, 'UPLOAD_ERROR', 'File tidak dapat dibaca.'));
    });
}

export function sendFile(res, { filename, contentType, buffer }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}
