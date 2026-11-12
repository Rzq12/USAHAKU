import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
process.env.UPLOAD_DIR ??= './uploads';

const { periodContaining, previousPeriod } = await import('../src/lib/dates.js');
const { formatRupiah, lineAmount } = await import('../src/lib/money.js');
const { toCsv } = await import('../src/lib/csv.js');
const { createZip } = await import('../src/lib/zip.js');
const { perMinuteLimiter } = await import('../src/middleware/common.js');
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

test('CSV output neutralizes spreadsheet formulas', () => {
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
