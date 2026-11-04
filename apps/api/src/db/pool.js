import pg from 'pg';
import { config } from '../config.js';

const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082;

pg.types.setTypeParser(INT8, Number);
pg.types.setTypeParser(NUMERIC, Number);
pg.types.setTypeParser(DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

/** Runs fn inside one database transaction; any throw rolls everything back. */
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
