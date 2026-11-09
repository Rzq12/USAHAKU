const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const BOM = '﻿';

function cell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value);
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
