import cron from 'node-cron';
import { pool } from '../db/pool.js';
import { deleteExpiredSessions } from '../db/users.js';
import { deleteExpiredAuditLogs } from '../db/audit.js';
import { runDueRules } from '../services/recurring.js';

async function runDailyJob() {
  const result = await runDueRules();
  await deleteExpiredSessions(pool);
  await deleteExpiredAuditLogs(pool);
  console.log(JSON.stringify({ level: 'info', message: 'daily job finished', ...result }));
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
