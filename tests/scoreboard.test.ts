import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateRange, pacificDate } from '../src/shared/dates';
import { showScores } from '../src/shared/scoreboard';
import { parseGamesQuery } from '../src/server/db/game-query';

test('Pacific dates handle late UTC games and daylight saving boundaries', () => {
  assert.equal(pacificDate(new Date('2026-10-21T02:00:00Z')), '2026-10-20');
  assert.equal(pacificDate(new Date('2026-11-01T08:30:00Z')), '2026-11-01');
  assert.equal(pacificDate(new Date('2026-11-01T09:30:00Z')), '2026-11-01');
  assert.deepEqual(dateRange('2026-10-31', '2026-11-02'), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
test('scheduled and canceled zero placeholders never display as played scores', () => {
  assert.equal(showScores('scheduled'), false); assert.equal(showScores('canceled'), false);
  assert.equal(showScores('unknown'), false); assert.equal(showScores('final'), true); assert.equal(showScores('in_progress'), true);
});
test('games API rejects invalid dates, paid leagues, reversed or unbounded date queries', () => {
  for (const query of ['from=2026-02-30&to=2026-03-01', 'league=nhl', 'league=nba%27%3BDROP+TABLE+games', 'from=2026-10-30&to=2026-10-20', 'from=2026-01-01&to=2026-12-31']) {
    assert.equal(parseGamesQuery(new URLSearchParams(query)).success, false);
  }
  assert.equal(parseGamesQuery(new URLSearchParams('league=wnba&view=results&from=2026-10-01&to=2026-10-30')).success, true);
});
