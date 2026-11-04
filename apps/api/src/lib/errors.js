export class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message, fields) => new AppError(400, 'VALIDATION_ERROR', message, fields);
export const fieldError = (field, message) => badRequest(message, { [field]: message });
export const unauthorized = (message = 'Silakan masuk terlebih dahulu.', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'Anda tidak punya akses ke fitur ini.') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Data tidak ditemukan.') =>
  new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, code = 'CONFLICT') => new AppError(409, code, message);
export const unprocessable = (message, code = 'UNPROCESSABLE') => new AppError(422, code, message);

const UNIQUE_VIOLATION = '23505';

/** Turns a unique-constraint failure into a field error using a constraint-to-field map. */
export function rethrowUnique(error, constraintMap) {
  const match = error.code === UNIQUE_VIOLATION && constraintMap[error.constraint];
  if (match) throw fieldError(match.field, match.message);
  throw error;
}
