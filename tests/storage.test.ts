import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import { storeGames } from '../src/server/ingestion/store';
import { syncNextLeague } from '../src/server/ingestion/scheduler';
import { readGames } from '../src/server/db/game-reader';
import { normalizeGame } from '../src/server/providers/balldontlie/normalize';
import { ProviderRequestError } from '../src/server/providers/balldontlie/adapter';
import type { FreeLeague } from '../src/shared/games';

test('PostgreSQL storage applies migrations, corrects scores, scopes IDs and rolls back failed batches', async t => {
  const db = await PGlite.create();
  const client = db as unknown as PoolClient;
  const reader = db as unknown as Pick<Pool, 'query'>;
  const window = { from: '2026-10-01', to: '2026-11-01' };
  const game = normalizeGame('nba', { id: 7, home_team: { id: 10 }, visitor_team: { id: 14, full_name: 'Los Angeles Lakers', abbreviation: 'LAL' }, date: '2026-10-20', datetime: '2026-10-21T02:00:00Z', status_state: 'final', home_team_score: 110, visitor_team_score: 100 });
  const startRun = async (league: FreeLeague) => (await db.query<{ id: string }>("INSERT INTO sync_runs (league,status) VALUES ($1,'running') RETURNING id::text", [league])).rows[0].id;
  const query = { league: 'nba' as const, view: 'all' as const, from: '2026-10-20', to: '2026-10-20' };
  try {
    await db.exec(await readFile('migrations/001_foundation.sql', 'utf8'));
    await db.exec(await readFile('migrations/002_game_ingestion.sql', 'utf8'));
    await t.test('game write and Pacific-date reads work against the actual SQL', async () => {
      await storeGames(client, 'nba', [game], await startRun('nba'), window, new Date());
      const response = await readGames(reader, query);
      assert.equal(response.data.length, 1); assert.equal(response.data[0].localDate, '2026-10-20');
      assert.equal(response.data[0].awayTeam.name, 'Los Angeles Lakers'); assert.equal(response.data[0].homeScore, 110);
      assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM teams WHERE enabled')).rows[0].count, 3);
      assert.equal((await readGames(reader, { ...query, from: '2026-10-21', to: '2026-10-21' })).data.length, 0);
      const detail = await readGames(reader, { ...query, from: '2030-01-01', to: '2030-01-01' }, 7);
      assert.equal(detail.data.length, 1); assert.equal(detail.data[0].providerId, 7);
      assert.equal((await readGames(reader, query, 9999)).data.length, 0);
    });
    await t.test('repeated snapshots are idempotent and corrections update the same row', async () => {
      const first = (await readGames(reader, query)).data[0];
      await storeGames(client, 'nba', [game], await startRun('nba'), window, new Date());
      const second = (await readGames(reader, query)).data[0];
      assert.equal(second.changedAt, first.changedAt);
      await storeGames(client, 'nba', [{ ...game, homeScore: 111 }], await startRun('nba'), window, new Date());
      const corrected = (await readGames(reader, query)).data;
      assert.equal(corrected.length, 1); assert.equal(corrected[0].homeScore, 111); assert.notEqual(corrected[0].changedAt, first.changedAt);
    });
    await t.test('same provider IDs in different leagues never collide', async () => {
      const wnba = normalizeGame('wnba', { id: 7, home_team: { id: 13 }, visitor_team: { id: 14, full_name: 'Los Angeles Sparks' }, date: '2026-10-21T02:00:00Z', status_state: 'canceled', home_score: 0, away_score: 0 });
      await storeGames(client, 'wnba', [wnba], await startRun('wnba'), window, new Date());
      const all = await readGames(reader, { ...query, league: 'all' });
      assert.equal(all.data.length, 2);
      assert.equal((await readGames(reader, { ...query, league: 'wnba', view: 'results' })).data.length, 0);
    });
    await t.test('a bad row rolls back the entire batch and retains previous games', async () => {
      const bad = { ...game, providerId: 9, awayTeamId: game.homeTeamId, awayTeam: game.homeTeam };
      await assert.rejects(storeGames(client, 'nba', [{ ...game, providerId: 8 }, bad], await startRun('nba'), window, new Date()));
      const saved = await readGames(reader, query);
      assert.equal(saved.data.length, 1); assert.equal(saved.data[0].homeScore, 111);
    });
    await t.test('scheduler persists a request slot and retains cached games after provider failure', async () => {
      await db.query("UPDATE ingestion_state SET next_sync_at=now() WHERE league='nba'");
      const controller = new AbortController();
      let calls = 0;
      assert.equal(await syncNextLeague(client, [{ league: 'nba', async getGames() { calls++; return { games: [game], nextCursor: null }; } }], 60, controller.signal), true);
      assert.equal(calls, 1);
      assert.equal((await db.query<{ spaced: boolean }>("SELECT next_request_at > now() AS spaced FROM provider_throttle")).rows[0].spaced, true);
      await db.query("UPDATE ingestion_state SET next_sync_at=now() WHERE league='nba'");
      await db.query('UPDATE provider_throttle SET next_request_at=now()');
      await syncNextLeague(client, [{ league: 'nba', async getGames() { throw new ProviderRequestError(401); } }], 60, controller.signal);
      const response = await readGames(reader, query);
      assert.equal(response.data.length, 1); assert.equal(response.data[0].homeScore, 110);
      assert.equal(response.sync.leagues.find(s => s.league === 'nba')?.lastErrorCode, 'HTTP_401');
      assert.ok(response.sync.leagues.find(s => s.league === 'nba')?.lastSuccessAt);
    });
  } finally { await db.close(); }
});
