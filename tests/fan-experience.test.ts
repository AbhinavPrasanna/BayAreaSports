import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePreferences, nextGameForTeam } from '../src/shared/fan-preferences';
import { startVisibleRefresh, SCORE_REFRESH_MS, type RefreshEnvironment } from '../src/components/refresh-lifecycle';
import { captureScroll, restoreScroll, type ScrollEnvironment } from '../src/components/scroll-preservation';
import { GameCard } from '../src/components/game-ui';
import { normalizeGame } from '../src/server/providers/balldontlie/normalize';
import type { StoredGame } from '../src/shared/games';

function fixture(id: number, date = '2026-10-21', status: StoredGame['status'] = 'scheduled'): StoredGame {
  return { ...normalizeGame('nba', { id, home_team: { id: 10 }, visitor_team: { id: 14, full_name: 'Los Angeles Lakers' }, date, datetime: `${date}T23:00:00Z`, status_state: status, home_team_score: 94, visitor_team_score: 71 }), localDate: date, observedAt: `${date}T23:30:00Z`, changedAt: `${date}T23:30:00Z` };
}

test('saved preferences recover safely, deduplicate teams, exclude paid leagues and preserve an empty lineup', () => {
  assert.deepEqual(parsePreferences(null).leagues, ['nba', 'nfl', 'wnba']);
  assert.equal(parsePreferences('broken-json').hideScores, false);
  assert.deepEqual(parsePreferences(JSON.stringify({ leagues: ['nfl', 'nhl', 'nfl'], hideScores: true })), { leagues: ['nfl'], hideScores: true });
  assert.deepEqual(parsePreferences(JSON.stringify({ leagues: [], hideScores: false })).leagues, []);
});

test('next game prioritizes live games and excludes completed/canceled or past scheduled games', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const games = [fixture(1, '2026-10-20'), fixture(2, '2026-10-21', 'final'), fixture(3, '2026-10-21', 'canceled'), fixture(4, '2026-10-22'), fixture(5)];
  assert.equal(nextGameForTeam(games, 'nba', now, '2026-10-21')?.providerId, 5);
  assert.equal(nextGameForTeam([...games, fixture(6, '2026-10-20', 'in_progress')], 'nba', now, '2026-10-21')?.providerId, 6);
  assert.equal(nextGameForTeam(games, 'nfl', now, '2026-10-21'), undefined);
});

test('spoiler protection removes numeric scores and winner styling from the rendered card', () => {
  const props = { game: fixture(1, '2026-10-21', 'final'), now: Date.parse('2026-10-21T23:40:00Z'), delayed: false, protection: true, onReveal: () => {}, onOpen: () => {} };
  const protectedCard = renderToStaticMarkup(createElement(GameCard, { ...props, hideScore: true }));
  assert.doesNotMatch(protectedCard, /game-score">(?:94|71)</);
  assert.doesNotMatch(protectedCard, /game-team winner/);
  assert.match(protectedCard, /Reveal score/);
  const revealed = renderToStaticMarkup(createElement(GameCard, { ...props, hideScore: false }));
  assert.match(revealed, /game-score">94</);
  assert.match(revealed, /game-team winner/);
  assert.match(revealed, /Hide score/);
});

test('visible refresh polls every 15 seconds, pauses in background/offline and immediately resumes', () => {
  const document = new EventTarget(); const window = new EventTarget();
  let visible = true; let online = true; let polls = 0; let offlineNotices = 0;
  let interval: (() => void) | undefined; let canceled = false;
  const environment: RefreshEnvironment = {
    document, window, visible: () => visible, online: () => online,
    every(callback, ms) { assert.equal(ms, SCORE_REFRESH_MS); assert.equal(ms, 15_000); interval = callback; return 9; },
    cancel(timer) { assert.equal(timer, 9); canceled = true; },
  };
  const stop = startVisibleRefresh(() => polls++, environment, () => offlineNotices++);
  assert.equal(polls, 1); interval!(); assert.equal(polls, 2);
  visible = false; document.dispatchEvent(new Event('visibilitychange')); interval!(); assert.equal(polls, 2);
  visible = true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(polls, 3);
  online = false; window.dispatchEvent(new Event('offline')); interval!(); assert.equal(polls, 3); assert.equal(offlineNotices, 1);
  online = true; window.dispatchEvent(new Event('online')); assert.equal(polls, 4);
  window.dispatchEvent(new Event('focus')); assert.equal(polls, 5);
  stop(); assert.equal(canceled, true); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); assert.equal(polls, 5);
});

test('scroll restoration keeps the visible game anchored after content is inserted above it', () => {
  let y = 700; let rows = [{ key: 'old', top: -120, bottom: -10 }, { key: 'nba:7', top: -30, bottom: 170 }, { key: 'nfl:8', top: 200, bottom: 400 }];
  const environment: ScrollEnvironment = { position: () => ({ x: 0, y }), anchors: () => rows, move: (_x, nextY) => { y = nextY; } };
  const saved = captureScroll(environment);
  rows = [{ key: 'new', top: -100, bottom: 100 }, { key: 'nba:7', top: 70, bottom: 270 }, { key: 'nfl:8', top: 300, bottom: 500 }];
  restoreScroll(saved, environment); assert.equal(y, 800);
});

test('scroll restoration falls back to another visible game if the first game disappears', () => {
  let y = 500; let rows = [{ key: 'a', top: 0, bottom: 150 }, { key: 'b', top: 170, bottom: 320 }];
  const environment: ScrollEnvironment = { position: () => ({ x: 0, y }), anchors: () => rows, move: (_x, nextY) => { y = nextY; } };
  const saved = captureScroll(environment);
  rows = [{ key: 'b', top: 20, bottom: 170 }]; restoreScroll(saved, environment); assert.equal(y, 350);
});
