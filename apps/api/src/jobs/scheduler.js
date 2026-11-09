import cron from 'node-cron';
import { pool } from '../db/pool.js';
import { deleteExpiredSessions } from '../db/users.js';
import { deleteExpiredAuditLogs } from '../db/audit.js';

async function runDailyJob() {
  await deleteExpiredSessions(pool);
  await deleteExpiredAuditLogs(pool);
  console.log(JSON.stringify({ level: 'info', message: 'daily job finished' }));
}

export function startScheduler() {
  cron.schedule(
    '5 0 * * *',
    () =>
      runDailyJob().catch((error) =>
        console.error(
          JSON.stringify({ level: 'error', message: error.message, stack: error.stack }),
        ),
      ),
    { timezone: 'Asia/Jakarta' },
  );
}
