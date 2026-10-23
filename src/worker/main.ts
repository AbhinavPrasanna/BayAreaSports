import { setTimeout as sleep } from 'node:timers/promises';
import { loadLocalEnvironment } from '../server/config/load-env';
import { ConfigurationError, parseWorkerEnv } from '../server/config/env';
import { closePool, getPool } from '../server/db/pool';
import { BallDontLieAdapter } from '../server/providers/balldontlie/adapter';
import { syncNextLeague } from '../server/ingestion/scheduler';
import { importReviewedMedia, loadReviewedMedia } from '../server/media/reviewed-media';
import { syncNextHighlights } from '../server/media/highlight-discovery';
import { syncNextRecordPage } from '../server/ingestion/season-records';
import { configurePlayerStats,syncNextPlayerStats } from '../server/ingestion/player-stats';
import { configurePlayerStatus,syncNextPlayerStatus } from '../server/ingestion/player-status';

async function main() {
  loadLocalEnvironment();
  const config = parseWorkerEnv();
  const adapters = config.ENABLED_LEAGUES.map(league => new BallDontLieAdapter(league, config.BALLDONTLIE_API_KEY));
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  const pool = getPool();
  const reviewedMedia = loadReviewedMedia();
  let mediaCheckAfter = 0;
  let highlightCheckAfter = 0;
  const lockClient = await pool.connect();
  let ownsLock = false;
  try {
    const result = await lockClient.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(20261020, 1) AS acquired');
    ownsLock = result.rows[0]?.acquired === true;
    if (!ownsLock) throw new Error('Another worker already owns the scheduler lock.');
    // The advisory lock is session-scoped. Exit if that connection is lost.
    lockClient.on('error', () => { console.error(JSON.stringify({ event: 'worker_lock_connection_lost' })); stop.abort(); process.exitCode = 1; });
    await lockClient.query("UPDATE sync_runs SET status='failed', completed_at=now(), error_code='WORKER_RESTART' WHERE status='running'");
    await configurePlayerStats(lockClient,config.PLAYER_STATS_LEAGUES);
    await configurePlayerStatus(lockClient,config.PLAYER_STATUS_LEAGUES);
    console.log(JSON.stringify({ event: 'worker_started', leagues: adapters.map(adapter => adapter.league), mode: 'game_ingestion' }));
    console.log(JSON.stringify({ event: 'highlights_discovery', enabled: config.HIGHLIGHTS_ENABLED && !!config.YOUTUBE_API_KEY }));
    while (!stop.signal.aborted) {
      await lockClient.query("INSERT INTO worker_heartbeats (worker_name, last_seen_at) VALUES ('scheduler', now()) ON CONFLICT (worker_name) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at");
      await syncNextLeague(lockClient, adapters, config.WORKER_INTERVAL_SECONDS, stop.signal).catch(error => { if (!stop.signal.aborted) throw error; });
      if (!stop.signal.aborted) await syncNextRecordPage(lockClient,adapters,stop.signal).catch(()=>{
        if(!stop.signal.aborted) console.error(JSON.stringify({event:'season_records_storage_failed'}));
      });
      if(!stop.signal.aborted)await syncNextPlayerStats(lockClient,adapters,config.PLAYER_STATS_LEAGUES,stop.signal).catch(()=>{
        if(!stop.signal.aborted)console.error(JSON.stringify({event:'player_stats_storage_failed'}));
      });
      if (Date.now() >= mediaCheckAfter && !stop.signal.aborted) {
        // A failed media refresh must not stop score ingestion or consume provider quota.
        await importReviewedMedia(lockClient, reviewedMedia).catch(() => console.error(JSON.stringify({ event: 'media_import_failed' })));
        mediaCheckAfter = Date.now() + 600_000;
      }
      if(!stop.signal.aborted)await syncNextPlayerStatus(lockClient,adapters,config.PLAYER_STATUS_LEAGUES,stop.signal).catch(()=>{
        if(!stop.signal.aborted)console.error(JSON.stringify({event:'player_status_storage_failed'}));
      });
      if (Date.now() >= highlightCheckAfter && !stop.signal.aborted) {
        await syncNextHighlights(lockClient, config.HIGHLIGHTS_ENABLED ? config.YOUTUBE_API_KEY : undefined, config.ENABLED_LEAGUES, stop.signal)
          .catch(() => { if (!stop.signal.aborted) console.error(JSON.stringify({ event: 'highlights_storage_failed' })); });
        highlightCheckAfter = Date.now() + 60_000;
      }
      await sleep(5000, undefined, { signal: stop.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
    }
  } finally {
    if (ownsLock && !stop.signal.aborted) await lockClient.query('SELECT pg_advisory_unlock(20261020, 1)').catch(() => {});
    lockClient.release(true);
    await closePool();
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
  }
}

main().catch(error => {
  console.error(error instanceof ConfigurationError ? error.message : 'Worker stopped after an initialization or database failure. Connection details omitted.');
  process.exitCode = 1;
  void closePool();
});
