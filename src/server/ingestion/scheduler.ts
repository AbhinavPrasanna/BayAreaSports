import { setTimeout as sleep } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { followedTeams, type FreeLeague } from '../../shared/games';
import { addDays, dateRange, ingestionWindow } from '../../shared/dates';
import type { SportsProvider } from '../providers/types';
import { fetchTeamGames } from './fetch-games';
import { failurePolicy, REQUEST_SPACING_MS } from './policy';
import { storeGames } from './store';

async function reserveRequest(client: PoolClient, signal: AbortSignal) {
  const slot = await client.query<{ allowed_at: Date }>(`UPDATE provider_throttle
    SET next_request_at=GREATEST(next_request_at,clock_timestamp()) + ($1 * interval '1 millisecond')
    WHERE provider='balldontlie' RETURNING next_request_at - ($1 * interval '1 millisecond') AS allowed_at`, [REQUEST_SPACING_MS]);
  if (!slot.rows[0]) throw new Error('Provider throttle was not initialized.');
  await sleep(Math.max(0, slot.rows[0].allowed_at.getTime() - Date.now()), undefined, { signal });
}

export async function syncNextLeague(client: PoolClient, providers: SportsProvider[], intervalSeconds: number, signal: AbortSignal): Promise<boolean> {
  const due = await client.query<{ league: FreeLeague; consecutive_failures: number }>(`SELECT league, consecutive_failures FROM ingestion_state
    WHERE league=ANY($1::text[]) AND next_sync_at<=now() ORDER BY next_sync_at, league LIMIT 1`, [providers.map(p => p.league)]);
  if (!due.rows[0]) return false;
  const state = due.rows[0];
  const provider = providers.find(p => p.league === state.league)!;
  const team = followedTeams.find(t => t.league === state.league)!;
  const started = Date.now();
  const run = await client.query<{ id: string }>("INSERT INTO sync_runs (league,status) VALUES ($1,'running') RETURNING id::text", [state.league]);
  const runId = run.rows[0].id;
  await client.query('UPDATE ingestion_state SET last_attempt_at=now() WHERE league=$1', [state.league]);
  const window = ingestionWindow();
  try {
    // Pad UTC date filters so late Pacific games stay inside the requested local window.
    const games = await fetchTeamGames(provider, team.providerId, dateRange(addDays(window.from, -1), addDays(window.to, 1)), () => reserveRequest(client, signal), signal);
    signal.throwIfAborted();
    await storeGames(client, state.league, games, runId, window, new Date(Math.max(Date.now() + 1000, started + intervalSeconds * 1000)));
    console.log(JSON.stringify({ event: 'games_synced', league: state.league, games: games.length }));
  } catch (error) {
    if (signal.aborted) throw error;
    const failure = failurePolicy(error, state.consecutive_failures + 1, intervalSeconds);
    const nextSync = new Date(Date.now() + failure.delayMs);
    if (failure.code === 'RATE_LIMITED') await client.query("UPDATE provider_throttle SET next_request_at=GREATEST(next_request_at,$1) WHERE provider='balldontlie'", [nextSync]);
    await client.query(`UPDATE ingestion_state SET last_error_code=$2, consecutive_failures=consecutive_failures+1, next_sync_at=$3 WHERE league=$1`, [state.league, failure.code, nextSync]);
    await client.query("UPDATE sync_runs SET status='failed', completed_at=now(), error_code=$2 WHERE id=$1", [runId, failure.code]);
    console.error(JSON.stringify({ event: 'game_sync_failed', league: state.league, code: failure.code, retryAt: nextSync.toISOString() }));
  }
  return true;
}
