import type { Pool } from 'pg';

export async function readReadiness(pool: Pick<Pool, 'query'>) {
  const result = await pool.query<{ worker: boolean; feeds: boolean; backup: boolean; restore: boolean }>(`
    SELECT
      EXISTS(SELECT 1 FROM worker_heartbeats WHERE worker_name='scheduler' AND last_seen_at > now()-interval '3 minutes') AS worker,
      (SELECT count(*)=3 AND bool_and(last_success_at > now()-interval '10 minutes') FROM ingestion_state WHERE league IN ('nba','nfl','wnba')) AS feeds,
      EXISTS(SELECT 1 FROM operational_checks WHERE name='backup' AND succeeded_at > now()-interval '8 hours') AS backup,
      EXISTS(SELECT 1 FROM operational_checks WHERE name='restore' AND succeeded_at > now()-interval '35 days') AS restore`);
  const checks = result.rows[0];
  return { status: checks && Object.values(checks).every(value => value === true) ? 'ok' : 'degraded', checks };
}
