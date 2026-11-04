import { z } from 'zod';
import { badRequest } from './errors.js';
import { addDays, isValidDate, todayJakarta } from './dates.js';

z.setErrorMap((issue, ctx) => {
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return { message: 'Wajib diisi.' };
  }
  if (issue.code === 'too_small') {
    if (issue.type === 'string') return { message: `Minimal ${issue.minimum} karakter.` };
    if (issue.type === 'array') return { message: `Minimal ${issue.minimum} baris.` };
    return { message: 'Nilai terlalu kecil.' };
  }
  if (issue.code === 'too_big') {
    if (issue.type === 'string') return { message: `Maksimal ${issue.maximum} karakter.` };
    if (issue.type === 'array') return { message: `Maksimal ${issue.maximum} baris.` };
    return { message: 'Nilai terlalu besar.' };
  }
  if (issue.code === 'invalid_string' && issue.validation === 'email') {
    return { message: 'Format email tidak valid.' };
  }
  if (issue.code === 'invalid_enum_value') return { message: 'Pilihan tidak valid.' };
  return { message: ctx.defaultError === 'Required' ? 'Wajib diisi.' : 'Format tidak valid.' };
});

export const MAX_AMOUNT = 999_999_999_999;

export const uuid = z.string().uuid();
export const dateString = z.string().refine(isValidDate, 'Tanggal tidak valid.');
export const notFarAhead = dateString.refine(
  (value) => value <= addDays(todayJakarta(), 366),
  'Tanggal tidak boleh lebih dari 1 tahun ke depan.',
);
export const amount = z
  .number({ invalid_type_error: 'Masukkan angka rupiah tanpa desimal.' })
  .int('Masukkan angka rupiah tanpa desimal.')
  .positive('Harus lebih dari 0.')
  .max(MAX_AMOUNT);
export const nonNegativeAmount = z
  .number({ invalid_type_error: 'Masukkan angka rupiah tanpa desimal.' })
  .int('Masukkan angka rupiah tanpa desimal.')
  .min(0, 'Tidak boleh kurang dari 0.')
  .max(MAX_AMOUNT);
export const quantity = z
  .number({ invalid_type_error: 'Masukkan angka.' })
  .refine(
    (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6,
    'Maksimal 3 angka desimal.',
  );
export const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish()
    .transform((value) => value ?? null);

const queryBoolean = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
export { queryBoolean };

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const dateRangeQuery = z
  .object({ from: dateString, to: dateString })
  .refine((range) => range.to >= range.from, {
    path: ['to'],
    message: 'Tanggal akhir harus sama dengan atau setelah tanggal awal.',
  });

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw badRequest(Object.values(fields)[0], fields);
}
