import assert from 'node:assert/strict';
import test from 'node:test';
import { BallDontLieAdapter, ProviderRequestError } from '../src/server/providers/balldontlie/adapter';

test('a non-JSON access error is classified without leaking the key or response body', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('untrusted response body', { status: 401 }));
  const adapter = new BallDontLieAdapter('nba', 'synthetic-test-key');
  await assert.rejects(adapter.getGames({ teamId: 10, dates: ['2026-10-20'] }), error => error instanceof ProviderRequestError && error.status === 401 && !error.message.includes('synthetic-test-key') && !error.message.includes('untrusted'));
});

test('the adapter uses the sports API auth scheme and preserves a replay cursor', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.balldontlie.io');
    assert.equal(url.searchParams.get('team_ids[]'), '13');
    assert.equal(url.searchParams.get('cursor'), '7');
    assert.deepEqual(url.searchParams.getAll('dates[]'), ['2026-10-20']);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'synthetic-test-key');
    assert.equal(init?.redirect, 'error');
    return Response.json({ data: [{ id: 1, home_team: { id: 13 }, visitor_team: { id: 3 }, home_score: 82, away_score: 66, status_state: 'final', date: '2026-10-20T02:00:00Z' }], meta: { next_cursor: 7 } });
  });
  const page = await new BallDontLieAdapter('wnba', 'synthetic-test-key').getGames({ teamId: 13, dates: ['2026-10-20'], cursor: 7 });
  assert.equal(page.games[0].homeScore, 82);
  assert.equal(page.nextCursor, 7);
});
