import { describe, expect, it } from 'vitest';
import {
  accounting,
  formatDate,
  formatQty,
  groupDigits,
  parseDigits,
  periodFor,
  rupiah,
} from './format.js';
import { compressedSize } from './image.js';

describe('accounting', () => {
  it('puts negative report amounts in parentheses', () => {
    expect(accounting(-177000)).toBe('(Rp177.000)');
    expect(accounting(648000)).toBe('Rp648.000');
    expect(accounting(0)).toBe('Rp0');
  });
});

describe('rupiah', () => {
  it('uses dot thousands and no decimals', () => {
    expect(rupiah(1250000)).toBe('Rp1.250.000');
    expect(rupiah(0)).toBe('Rp0');
    expect(rupiah(-5000)).toBe('-Rp5.000');
    expect(rupiah(null)).toBe('Rp0');
  });
});

describe('money input helpers', () => {
  it('groups digits while typing and reads them back as an integer', () => {
    expect(groupDigits(1250000)).toBe('1.250.000');
    expect(parseDigits('1.250.000')).toBe(1250000);
    expect(parseDigits('Rp 75.000')).toBe(75000);
    expect(parseDigits('')).toBe(null);
  });
});

describe('dates and quantities', () => {
  it('formats dates as 04 Nov 2026', () => {
    expect(formatDate('2026-11-04')).toBe('04 Nov 2026');
    expect(formatDate(null)).toBe('');
  });
  it('uses a comma for decimal quantities', () => {
    expect(formatQty(2.5)).toBe('2,5');
    expect(formatQty(3)).toBe('3');
  });
});

describe('periodFor (BR-009)', () => {
  it('starts in the previous month before the start day (AC-004)', () => {
    expect(periodFor('2026-11-10', 25)).toEqual({ from: '2026-10-25', to: '2026-11-24' });
  });
  it('handles a plain calendar month and the previous period', () => {
    expect(periodFor('2026-11-10', 1)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodFor('2026-11-10', 1, -1)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
  it('crosses a year boundary', () => {
    expect(periodFor('2026-01-05', 25)).toEqual({ from: '2025-12-25', to: '2026-01-24' });
  });
});

describe('receipt compression size', () => {
  it('limits the long side to 1600 px and keeps the ratio', () => {
    expect(compressedSize(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(compressedSize(1000, 2000)).toEqual({ width: 800, height: 1600 });
    expect(compressedSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
