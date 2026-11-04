import { pool, withTx } from '../db/pool.js';
import { readAllEntities } from '../db/dataExport.js';
import { writeAudit } from '../db/audit.js';
import { toCsv } from '../lib/csv.js';
import { createZip } from '../lib/zip.js';
import { todayJakarta } from '../lib/dates.js';

export async function buildDataExport(actor, range) {
  const entities = await readAllEntities(pool, actor.business_id, range);
  const buffer = createZip(
    entities.map((entity) => ({
      name: `${entity.file}.csv`,
      content: toCsv(
        entity.columns,
        entity.rows.map((row) => entity.columns.map((column) => row[column])),
      ),
    })),
  );
  await withTx((client) =>
    writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'export',
      entityType: 'data_export',
      detail: { from: range.from ?? null, to: range.to ?? null },
    }),
  );
  return {
    buffer,
    contentType: 'application/zip',
    filename: `usahaku-data-${todayJakarta()}.zip`,
  };
}
