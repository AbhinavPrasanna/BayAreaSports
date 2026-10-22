import { z } from 'zod';
import type { FreeLeague } from '../../../shared/games';
import type { GameQuery, SportsProvider } from '../types';
import { normalizeGame } from './normalize';
import type { RecordPhase } from '../../../shared/records';
import { normalizePlayerStats } from './player-stats';

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
    return this.requestGames(url, signal);
  }
  async getSeasonGames(season: number, phase: RecordPhase, endDate: string, cursor: number | undefined, signal?: AbortSignal) {
    const url = new URL(`https://api.balldontlie.io/${this.league}/v1/games`);
    url.searchParams.set('seasons[]', String(season));
    url.searchParams.set('per_page', '100');
    if (cursor !== undefined) url.searchParams.set('cursor', String(cursor));
    if (this.league === 'nfl') url.searchParams.set('season_types[]', phase === 'regular' ? '2' : '3');
    else {
      url.searchParams.set('season_type', this.league === 'wnba' ? phase === 'regular' ? '2' : '3' : phase);
      url.searchParams.set('end_date', endDate);
    }
    return this.requestGames(url, signal);
  }
  async getPlayerStats(game:{providerId:number;homeTeamId:number;awayTeamId:number},cursor:number|undefined,signal?:AbortSignal) {
    const path=this.league==='nba'?'v1/stats':`${this.league}/v1/${this.league==='wnba'?'player_stats':'stats'}`;
    const url=new URL(`https://api.balldontlie.io/${path}`);
    url.searchParams.set('game_ids[]',String(game.providerId));url.searchParams.set('per_page','100');
    if(cursor!==undefined)url.searchParams.set('cursor',String(cursor));
    const page=await this.requestPage(url,signal);
    return {players:page.data.map(row=>normalizePlayerStats(this.league,row,game.providerId,[game.homeTeamId,game.awayTeamId])),nextCursor:page.meta?.next_cursor??null};
  }
  private async requestGames(url:URL,signal?:AbortSignal){
    const page=await this.requestPage(url,signal);
    return {games:page.data.map(game=>normalizeGame(this.league,game)),nextCursor:page.meta?.next_cursor??null};
  }
  private async requestPage(url: URL, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: this.apiKey, Accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store' });
    } catch { throw new Error('Sports provider is unreachable. Request details omitted.'); }
    if (!response.ok) throw new ProviderRequestError(response.status, retryAfterMilliseconds(response.headers.get('retry-after')));
    const json: unknown = await response.json().catch(() => { throw new Error('Sports provider returned invalid JSON.'); });
    const page = pageSchema.safeParse(json);
    if (!page.success) throw new Error('Sports provider page failed validation. Raw payload omitted.');
    return page.data;
  }
}
