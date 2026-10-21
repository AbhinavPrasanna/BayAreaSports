import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGame } from '../src/server/providers/balldontlie/normalize';

const common = { id: 1, home_team: { id: 10 }, visitor_team: { id: 14 }, status_state: 'final', date: '2026-10-20', period: 4, time: 'Final' };
test('NBA uses the precise timestamp and preserves a legitimate zero score', () => {
  const game = normalizeGame('nba', { ...common, datetime: '2026-10-21T02:00:00Z', home_team_score: 0, visitor_team_score: 100 });
  assert.equal(game.startsAt, '2026-10-21T02:00:00.000Z');
  assert.equal(game.homeScore, 0);
  assert.equal(normalizeGame('nba', common).startsAt, null);
});
test('WNBA uses its own score fields and a new status degrades to unknown', () => {
  const game = normalizeGame('wnba', { ...common, date: '2026-10-20T02:00:00Z', home_score: 82, away_score: 66, status_state: 'new_provider_status' });
  assert.equal(game.homeScore, 82);
  assert.equal(game.awayScore, 66);
  assert.equal(game.status, 'unknown');
});
test('NFL preserves null scores and does not fabricate a clock', () => {
  const game = normalizeGame('nfl', { ...common, date: '2026-10-20T00:15:00Z', home_team_score: null, visitor_team_score: null });
  assert.equal(game.homeScore, null);
  assert.equal(game.clock, null);
  assert.equal(game.period, null);
});
test('malformed payload errors do not echo untrusted data', () => {
  assert.throws(() => normalizeGame('nba', { ...common, id: 'secret-untrusted-data' }), error => error instanceof Error && !error.message.includes('secret-untrusted-data'));
});
