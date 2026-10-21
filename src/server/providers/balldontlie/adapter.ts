import { z } from 'zod';
import type { FreeLeague } from '../../../shared/games';
import type { GameQuery, SportsProvider } from '../types';
import { normalizeGame } from './normalize';

const pageSchema = z.object({ data: z.array(z.unknown()), meta: z.object({ next_cursor: z.number().int().nullable().optional() }).optional() });

export class ProviderRequestError extends Error {
  constructor(readonly status: number, readonly retryAfterMs = 0) { super(`Sports provider request failed (HTTP ${status}).`); }
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 3_600_000)) : 0;
}

// Only the worker constructs this adapter. No key is exposed through the web API.
export class BallDontLieAdapter implements SportsProvider {
  constructor(readonly league: FreeLeague, private readonly apiKey: string) {}

  async getGames(query: GameQuery, signal?: AbortSignal) {
    const url = new URL(`https://api.balldontlie.io/${this.league}/v1/games`);
    url.searchParams.set('team_ids[]', String(query.teamId));
    url.searchParams.set('per_page', '100');
    if (query.cursor !== undefined) url.searchParams.set('cursor', String(query.cursor));
    for (const date of query.dates) url.searchParams.append('dates[]', date);
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: this.apiKey, Accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store' });
    } catch { throw new Error('Sports provider is unreachable. Request details omitted.'); }
    if (!response.ok) throw new ProviderRequestError(response.status, retryAfterMilliseconds(response.headers.get('retry-after')));
    const json: unknown = await response.json().catch(() => { throw new Error('Sports provider returned invalid JSON.'); });
    const page = pageSchema.safeParse(json);
    if (!page.success) throw new Error('Sports provider page failed validation. Raw payload omitted.');
    return { games: page.data.data.map(game => normalizeGame(this.league, game)), nextCursor: page.data.meta?.next_cursor ?? null };
  }
}
