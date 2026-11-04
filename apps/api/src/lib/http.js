import multer from 'multer';
import { AppError, fieldError } from './errors.js';

export const handle = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function pageResult(items, total, { page, limit }, extra = {}) {
  return { items, total, page, limit, ...extra };
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
