import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
process.env.UPLOAD_DIR ??= './uploads';

const { addMonthsClamped, periodContaining, previousPeriod } = await import('../src/lib/dates.js');
const { basisPointsOf, formatRupiah, lineAmount } = await import('../src/lib/money.js');
const { parseCsv, toCsv } = await import('../src/lib/csv.js');
const { createZip } = await import('../src/lib/zip.js');
const { perMinuteLimiter } = await import('../src/middleware/common.js');
const { computeTaxMonths } = await import('../src/services/tax.js');
const { debtStatus, daysOverdue } = await import('../src/services/debts.js');
const { nextOccurrence } = await import('../src/services/recurring.js');
const { agingBucket } = await import('../src/services/reports.js');
const { parseImportAmount, parseImportDate } = await import('../src/services/imports.js');
const { detectImageType } = await import('../src/services/transactions.js');
const { pool } = await import('../src/db/pool.js');

test.after(() => pool.end());

test('BR-009: period boundaries with start days 1, 25, and 28', () => {
  assert.deepEqual(periodContaining('2026-11-10', 1), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(periodContaining('2026-11-10', 25), { from: '2026-10-25', to: '2026-11-24' });
  assert.deepEqual(periodContaining('2026-11-25', 25), { from: '2026-11-25', to: '2026-12-24' });
  assert.deepEqual(periodContaining('2026-03-01', 28), { from: '2026-02-28', to: '2026-03-27' });
  assert.deepEqual(periodContaining('2026-01-05', 25), { from: '2025-12-25', to: '2026-01-24' });
  assert.deepEqual(previousPeriod({ from: '2026-11-01', to: '2026-11-30' }, 1), {
    from: '2026-10-01',
    to: '2026-10-31',
  });
});

test('BR-001: line amounts stay whole rupiah, including decimal quantities', () => {
  assert.equal(lineAmount(3, 10_000), 30_000);
  assert.equal(lineAmount(2.5, 1_001), 2_503);
  assert.equal(lineAmount(0.001, 999_999_999_999), 1_000_000_000);
  assert.ok(Number.isInteger(lineAmount(1.333, 777)));
  assert.equal(formatRupiah(1_250_000), 'Rp1.250.000');
  assert.equal(formatRupiah(-5_000), '-Rp5.000');
});

test('BR-007: debt status follows the paid amount, overdue compares the due date', () => {
  assert.equal(debtStatus(1000, 0), 'open');
  assert.equal(debtStatus(1000, 400), 'partial');
  assert.equal(debtStatus(1000, 1000), 'paid');
  const debt = { status: 'partial', due_date: '2026-11-03' };
  assert.equal(daysOverdue(debt, '2026-11-04'), 1);
  assert.equal(daysOverdue(debt, '2026-11-03'), 0);
  assert.equal(daysOverdue({ status: 'paid', due_date: '2026-01-01' }, '2026-11-04'), 0);
});

const SETTINGS_INDIVIDUAL = { taxpayerType: 'individual', rateBp: 50, threshold: 500_000_000 };

test('BR-012: Rp40,000,000 per month stays under the threshold, so all months are zero', () => {
  const months = computeTaxMonths(Array(12).fill(40_000_000), SETTINGS_INDIVIDUAL);
  assert.equal(months[11].cumulative, 480_000_000);
  assert.ok(months.every((month) => month.tax === 0));
});

test('BR-012: Rp60,000,000 per month taxes Rp40,000,000 in month 9, then the full turnover', () => {
  const months = computeTaxMonths(Array(12).fill(60_000_000), SETTINGS_INDIVIDUAL);
  assert.equal(months[7].tax, 0);
  assert.equal(months[8].taxable, 40_000_000);
  assert.equal(months[8].tax, basisPointsOf(40_000_000, 50));
  for (const index of [9, 10, 11]) assert.equal(months[index].tax, 300_000);
});

test('BR-012: a company has no threshold, and rate and threshold are inputs', () => {
  const company = computeTaxMonths([10_000_000], {
    taxpayerType: 'company',
    rateBp: 50,
    threshold: 0,
  });
  assert.equal(company[0].tax, 50_000);
  const custom = computeTaxMonths([100], {
    taxpayerType: 'individual',
    rateBp: 100,
    threshold: 40,
  });
  assert.equal(custom[0].taxable, 60);
  assert.equal(custom[0].tax, 0, 'rounds down to whole rupiah');
});

test('monthly recurrence clamps to shorter months and returns to the start day', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsClamped('2028-01-31', 1), '2028-02-29');
  const rule = { frequency: 'monthly', start_on: '2026-01-31' };
  assert.equal(nextOccurrence(rule, '2026-01-31'), '2026-02-28');
  assert.equal(nextOccurrence(rule, '2026-02-28'), '2026-03-31');
  assert.equal(nextOccurrence({ frequency: 'weekly' }, '2026-11-04'), '2026-11-11');
  assert.equal(nextOccurrence({ frequency: 'daily' }, '2026-12-31'), '2027-01-01');
});

test('receivable aging buckets', () => {
  assert.equal(agingBucket(0), 'days_0_30');
  assert.equal(agingBucket(30), 'days_0_30');
  assert.equal(agingBucket(31), 'days_31_60');
  assert.equal(agingBucket(61), 'days_61_90');
  assert.equal(agingBucket(91), 'days_over_90');
});

test('import parsing accepts Indonesian formats and rejects decimals (BR-001)', () => {
  assert.equal(parseImportAmount('1.250.000'), 1_250_000);
  assert.equal(parseImportAmount('Rp 1.250.000'), 1_250_000);
  assert.equal(parseImportAmount('1,250,000'), 1_250_000);
  assert.equal(parseImportAmount('-5000'), -5000);
  assert.equal(parseImportAmount('(5.000)'), -5000);
  assert.equal(parseImportAmount('250000.5'), null);
  assert.equal(parseImportAmount('abc'), null);
  assert.equal(parseImportAmount('0'), null);
  assert.equal(parseImportDate('2026-11-04'), '2026-11-04');
  assert.equal(parseImportDate('04/11/2026'), '2026-11-04');
  assert.equal(parseImportDate('4-1-2026'), '2026-01-04');
  assert.equal(parseImportDate('31/02/2026'), null);
  assert.equal(parseImportDate('kemarin'), null);
});

test('CSV parsing handles quotes and semicolons; output neutralizes spreadsheet formulas', () => {
  assert.deepEqual(parseCsv('a;b\n"x;y";"say ""hi"""\n'), [
    ['a', 'b'],
    ['x;y', 'say "hi"'],
  ]);
  assert.ok(toCsv(['note'], [['=SUM(A1)']]).includes("'=SUM(A1)"));
  assert.ok(toCsv(['n'], [[-5000]]).includes('-5000'));
});

test('ZIP output holds the original bytes under deflate', () => {
  const zip = createZip([{ name: 'a.csv', content: 'halo,dunia\n' }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLength = zip.readUInt16LE(26);
  const size = zip.readUInt32LE(18);
  const data = zip.subarray(30 + nameLength, 30 + nameLength + size);
  assert.equal(inflateRawSync(data).toString(), 'halo,dunia\n');
});

test('uploads are typed from their bytes, not their name', () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).mime, 'image/jpeg');
  assert.equal(detectImageType(Buffer.from('%PDF-1.7')), undefined);
});

test('login rate limit: the 11th attempt in a minute is refused, the next minute is fresh', () => {
  const allow = perMinuteLimiter(10);
  const now = 1_000_000_000_000;
  for (let i = 0; i < 10; i += 1) assert.equal(allow('ip', now), true);
  assert.equal(allow('ip', now), false);
  assert.equal(allow('ip', now + 60_000), true);
});
