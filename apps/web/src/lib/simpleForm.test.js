import { describe, expect, test } from 'vitest';
import {
  defaultAccountId,
  expenseCategories,
  expenseSaveHint,
  lineError,
  pickerHint,
  saleSaveHint,
  saveProblem,
} from './simpleForm.js';

describe('defaultAccountId', () => {
  test('picks the first active account', () => {
    const items = [
      { id: 'a', is_archived: true },
      { id: 'b', is_archived: false },
      { id: 'c', is_archived: false },
    ];
    expect(defaultAccountId({ items })).toBe('b');
  });

  test('is empty when there is nothing to pick', () => {
    expect(defaultAccountId({ items: [] })).toBe('');
    expect(defaultAccountId({ items: [{ id: 'a', is_archived: true }] })).toBe('');
    expect(defaultAccountId(null)).toBe('');
  });
});

describe('expenseCategories', () => {
  test('keeps active expense categories without children', () => {
    const items = [
      { id: 'p', name: 'Induk', type: 'expense', parent_id: null, is_archived: false },
      { id: 'c', name: 'Anak', type: 'expense', parent_id: 'p', is_archived: false },
      { id: 's', name: 'Sewa', type: 'expense', parent_id: null, is_archived: false },
      { id: 'x', name: 'Arsip', type: 'expense', parent_id: null, is_archived: true },
      { id: 'i', name: 'Masuk', type: 'income', parent_id: null, is_archived: false },
    ];
    expect(expenseCategories({ items }).map((category) => category.id)).toEqual(['c', 's']);
  });

  test('keeps a parent whose only children are archived', () => {
    const items = [
      { id: 'p', name: 'Induk', type: 'expense', parent_id: null, is_archived: false },
      { id: 'c', name: 'Anak', type: 'expense', parent_id: 'p', is_archived: true },
    ];
    expect(expenseCategories({ items }).map((category) => category.id)).toEqual(['p']);
  });

  test('puts everyday spending first and financing or asset categories last', () => {
    const everyday = {
      type: 'expense',
      parent_id: null,
      is_archived: false,
      cash_activity: 'operating',
    };
    const items = [
      { ...everyday, id: 'loan', name: 'Angsuran Pinjaman', cash_activity: 'financing' },
      { ...everyday, id: 'other', name: 'Lainnya' },
      { ...everyday, id: 'tool', name: 'Pembelian Peralatan', cash_activity: 'investing' },
      { ...everyday, id: 'rent', name: 'Sewa' },
    ];
    expect(expenseCategories({ items }).map((category) => category.id)).toEqual([
      'rent',
      'other',
      'loan',
      'tool',
    ]);
  });

  test('is empty before categories load', () => {
    expect(expenseCategories(null)).toEqual([]);
  });
});

describe('lineError', () => {
  test('shows the quantity or product problem of its own line', () => {
    expect(lineError({ 'items.1.qty': 'Harus lebih dari 0.' }, 1)).toBe('Harus lebih dari 0.');
    expect(lineError({ 'items.0.product_id': 'Produk tidak aktif.' }, 0)).toBe(
      'Produk tidak aktif.',
    );
    expect(lineError({ 'items.1.qty': 'Harus lebih dari 0.' }, 0)).toBeUndefined();
  });
});

describe('saveProblem', () => {
  test('prefers the message from the server', () => {
    expect(saveProblem('Stok Kopi hanya 2 kg.', {})).toBe('Stok Kopi hanya 2 kg.');
  });

  test('points at the marked fields when the error belongs to a field', () => {
    expect(saveProblem(null, { 'items.0.qty': 'Harus lebih dari 0.' })).toBe(
      'Belum tersimpan. Periksa isian yang bertanda merah.',
    );
  });

  test('is empty when nothing went wrong', () => {
    expect(saveProblem(null, {})).toBeNull();
  });
});

describe('save hints', () => {
  test('a sale needs an item', () => {
    expect(saleSaveHint({ lineCount: 0 })).toBe('Ketuk barang yang terjual dulu.');
    expect(saleSaveHint({ lineCount: 1 })).toBeNull();
  });

  test('an expense needs an amount, then a purpose', () => {
    expect(expenseSaveHint({ amount: null, categoryId: '' })).toBe('Isi berapa uangnya dulu.');
    expect(expenseSaveHint({ amount: 5000, categoryId: '' })).toBe('Pilih untuk apa uang ini.');
    expect(expenseSaveHint({ amount: 5000, categoryId: 'a' })).toBeNull();
  });
});

describe('pickerHint', () => {
  test('says when more products exist than are shown', () => {
    expect(pickerHint(8, 30)).toBe('Menampilkan 8 dari 30 barang. Ketik nama untuk mencari.');
    expect(pickerHint(8, 8)).toBeNull();
    expect(pickerHint(0, 0)).toBeNull();
  });
});
