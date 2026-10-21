import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTeamGames } from '../src/server/ingestion/fetch-games';
import { failurePolicy, IngestionError } from '../src/server/ingestion/policy';
import { ProviderRequestError, retryAfterMilliseconds } from '../src/server/providers/balldontlie/adapter';
import { normalizeGame } from '../src/server/providers/balldontlie/normalize';
import type { SportsProvider } from '../src/server/providers/types';

const game = normalizeGame('nba', { id: 7, home_team: { id: 10, full_name: 'Golden State Warriors' }, visitor_team: { id: 14, full_name: 'Los Angeles Lakers', abbreviation: 'LAL' }, status_state: 'scheduled', date: '2026-10-20', datetime: '2026-10-21T02:00:00Z' });
test('ingestion follows pagination and reserves a request slot for every page', async () => {
  let requests = 0; let slots = 0;
  const provider: SportsProvider = { league: 'nba', async getGames(query) {
    requests++; assert.equal(query.cursor, requests === 1 ? undefined : 8);
    return { games: [game], nextCursor: requests === 1 ? 8 : null };
  } };
  const games = await fetchTeamGames(provider, 10, ['2026-10-20'], async () => { slots++; });
  assert.equal(requests, 2); assert.equal(slots, 2); assert.equal(games.length, 1);
  assert.equal(games[0].awayTeam.name, 'Los Angeles Lakers');
});
test('ingestion rejects cursor loops and data that violates the requested team filter', async () => {
  const loop: SportsProvider = { league: 'nba', async getGames() { return { games: [game], nextCursor: 8 }; } };
  await assert.rejects(fetchTeamGames(loop, 10, [], async () => {}), (error: unknown) => error instanceof IngestionError && error.code === 'CURSOR_LOOP');
  const wrong: SportsProvider = { league: 'nba', async getGames() { return { games: [{ ...game, homeTeamId: 22 }], nextCursor: null }; } };
  await assert.rejects(fetchTeamGames(wrong, 10, [], async () => {}), (error: unknown) => error instanceof IngestionError && error.code === 'TEAM_FILTER_MISMATCH');
});
test('canceled ingestion never sends a provider request', async () => {
  let requests = 0; const stop = new AbortController(); stop.abort();
  const provider: SportsProvider = { league: 'nba', async getGames() { requests++; return { games: [], nextCursor: null }; } };
  await assert.rejects(fetchTeamGames(provider, 10, [], async () => {}, stop.signal));
  assert.equal(requests, 0);
});
test('rate-limit and entitlement errors back off without exposing response content', () => {
  assert.deepEqual(failurePolicy(new ProviderRequestError(429, 90_000), 1, 60), { code: 'RATE_LIMITED', delayMs: 90_000 });
  assert.equal(failurePolicy(new ProviderRequestError(401), 1, 60).delayMs, 900_000);
  assert.ok(failurePolicy(new Error('private response'), 8, 60).delayMs <= 1_800_000);
  assert.doesNotMatch(JSON.stringify(failurePolicy(new Error('private response'), 1, 60)), /private response/);
  assert.equal(retryAfterMilliseconds('90'), 90_000);
  assert.equal(retryAfterMilliseconds('Wed, 21 Oct 2026 02:02:00 GMT', Date.parse('2026-10-21T02:00:00Z')), 120_000);
});
