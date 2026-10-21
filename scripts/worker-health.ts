import { getPool, closePool } from '../src/server/db/pool';

async function main() {
  try {
    const result = await getPool().query<{ healthy: boolean }>("SELECT last_seen_at > now() - interval '3 minutes' AS healthy FROM worker_heartbeats WHERE worker_name='scheduler'");
    if (!result.rows[0]?.healthy) process.exitCode = 1;
  } catch { process.exitCode = 1; }
  finally { await closePool(); }
}
void main();
