import pg from 'pg';
import { parseDatabaseEnv } from '../config/env';

const globals = globalThis as typeof globalThis & { baylinePool?: pg.Pool };
export function getPool(): pg.Pool {
  if (!globals.baylinePool) {
    const { DATABASE_URL } = parseDatabaseEnv();
    globals.baylinePool = new pg.Pool({ connectionString: DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
    globals.baylinePool.on('error', () => console.error(JSON.stringify({ event: 'database_connection_error' })));
  }
  return globals.baylinePool;
}

export async function closePool() {
  const pool = globals.baylinePool;
  globals.baylinePool = undefined;
  if (pool) await pool.end();
}
