import { z } from 'zod';
import type { PoolClient } from 'pg';
import { broadcastSchema, type Broadcast, type ReviewedMedia } from '../../shared/game-media';

export const NBA_SCHEDULE_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
export const WARRIORS_SCHEDULE_URL = 'https://www.nba.com/warriors/schedule';
const WARRIORS = 1610612744;
const MAX_BYTES = 16 * 1024 * 1024;
const team = z.object({ teamId: z.number().int(), teamTricode: z.string().regex(/^[A-Z]{3}$/) });
const broadcaster = z.object({
  broadcasterDisplay: z.string().trim().min(1).max(80),
  broadcasterMedia: z.string(), broadcasterTeamId: z.number().int(),
  broadcasterVideoLink: z.string().max(2000).optional(),
  localizationRegion: z.string().max(80).optional(),
});
const groups = ['nationalBroadcasters','nationalOttBroadcasters','homeTvBroadcasters','homeOttBroadcasters','awayTvBroadcasters','awayOttBroadcasters'] as const;
const television = z.object(Object.fromEntries(groups.map(key => [key,z.array(broadcaster).max(30)])) as Record<typeof groups[number], z.ZodArray<typeof broadcaster>>);
const officialGame = z.object({
  gameId: z.string().regex(/^\d{10}$/), gameDateTimeUTC: z.string().datetime(),
  homeTeam: team, awayTeam: team, postponedStatus: z.string(), broadcasters: television,
});
export interface WarriorsBroadcastGame { nbaGameId: string; startsAt: string; home: string; away: string; broadcasts: Broadcast[]; }
export class BroadcastFailure extends Error { constructor(public readonly code: string, public readonly retryMs = 0) { super(code); } }

/** Read only national US TV/OTT and the Warriors' own regional options, never opponent TV or radio. */
export function parseWarriorsBroadcasts(raw: unknown): WarriorsBroadcastGame[] {
  const root = z.object({leagueSchedule:z.object({gameDates:z.array(z.object({games:z.array(z.unknown()).max(40)})).min(1).max(500)})}).parse(raw);
  const games: WarriorsBroadcastGame[] = [], ids = new Set<string>();
  for (const day of root.leagueSchedule.gameDates) for (const item of day.games) {
    // Inspect identity before requiring broadcast fields on unrelated league games.
    const identityTeam=z.object({teamId:z.number().int()});
    const identity = z.object({homeTeam:identityTeam,awayTeam:identityTeam}).parse(item);
    if (![identity.homeTeam.teamId,identity.awayTeam.teamId].includes(WARRIORS)) continue;
    const game = officialGame.parse(item);
    const warriorsHome = game.homeTeam.teamId === WARRIORS;
    if ((warriorsHome ? game.homeTeam : game.awayTeam).teamTricode !== 'GSW' || game.homeTeam.teamId === game.awayTeam.teamId || game.homeTeam.teamTricode === game.awayTeam.teamTricode || ids.has(game.gameId)) throw new BroadcastFailure('BROADCAST_SCHEMA');
    ids.add(game.gameId);
    const local = warriorsHome ? ['homeTvBroadcasters','homeOttBroadcasters'] as const : ['awayTvBroadcasters','awayOttBroadcasters'] as const;
    const selected = [...game.broadcasters.nationalBroadcasters,...game.broadcasters.nationalOttBroadcasters,
      ...local.flatMap(key => game.broadcasters[key].filter(row => row.broadcasterTeamId === WARRIORS))];
    const fallback = `https://www.nba.com/how-to-watch-game-redirect/${game.gameId}?partnerRef=Warriors&platform=web&surface=gameblock`;
    const broadcasts: Broadcast[] = [];
    for (const row of selected) {
      // The NBA also includes Canadian carriage under a Warriors team ID, sometimes with a blank region.
      if (!['tv','ott','stream'].includes(row.broadcasterMedia.toLowerCase()) || !['','US','National','West'].includes(row.localizationRegion ?? '') || /^(TSN|SN\/SN|Sportsnet|RDS)\b/i.test(row.broadcasterDisplay)) continue;
      const stream = /peacock|prime video/i.test(row.broadcasterDisplay);
      const candidate = {label:row.broadcasterDisplay,url:row.broadcasterVideoLink || fallback,kind:stream?'stream' as const:'tv' as const,region:'US' as const,access:stream?'Subscription required; regional restrictions may apply.':'Check your TV provider and location for access.'};
      // Unrecognized outbound links become an official, game-specific NBA watch link.
      if (!broadcastSchema.safeParse(candidate).success) candidate.url = fallback;
      const value = broadcastSchema.parse(candidate);
      if (!broadcasts.some(existing => existing.label.toLowerCase() === value.label.toLowerCase())) broadcasts.push(value);
    }
    if (broadcasts.length > 8) throw new BroadcastFailure('BROADCAST_SCHEMA');
    games.push({nbaGameId:game.gameId,startsAt:game.gameDateTimeUTC,home:game.homeTeam.teamTricode,away:game.awayTeam.teamTricode,broadcasts:game.postponedStatus==='N'?broadcasts:[]});
  }
  if (!games.length) throw new BroadcastFailure('BROADCAST_EMPTY');
  return games;
}

export async function fetchWarriorsBroadcasts(signal: AbortSignal, request: typeof fetch = fetch): Promise<WarriorsBroadcastGame[]> {
  try {
    const response = await request(NBA_SCHEDULE_URL,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json','Referer':'https://www.nba.com/'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)])});
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry)*1000 : retry ? Date.parse(retry)-Date.now() : 0;
      throw new BroadcastFailure(response.status===429?'BROADCAST_RATE_LIMIT':'BROADCAST_HTTP',response.status===429?Math.min(86400_000,Math.max(900_000,seconds||0)):0);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new BroadcastFailure('BROADCAST_BODY');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const {done,value} = await reader.read(); if(done) break; bytes+=value.byteLength; if(bytes>MAX_BYTES) throw new BroadcastFailure('BROADCAST_SIZE'); chunks.push(value); } }
    finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
    return parseWarriorsBroadcasts(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof BroadcastFailure) throw error;
    throw new BroadcastFailure(error instanceof z.ZodError || error instanceof SyntaxError?'BROADCAST_SCHEMA':'BROADCAST_NETWORK');
  }
}

/** Runs under the scheduler's session lock. The persisted reservation survives worker restarts. */
export async function syncWarriorsBroadcasts(client: Pick<PoolClient,'query'>, signal: AbortSignal, request: typeof fetch = fetch) {
  if(signal.aborted) return false;
  const due = await client.query<{failures:number}>(`UPDATE broadcast_sync_state SET last_attempt_at=now(),next_check_at=now()+interval '15 minutes' WHERE source='nba-warriors' AND next_check_at<=now() RETURNING consecutive_failures AS failures`);
  if (!due.rows.length) return false;
  try {
    const snapshots = await fetchWarriorsBroadcasts(signal,request);
    signal.throwIfAborted();
    await client.query('BEGIN');
    try {
      const stored = await client.query<{providerId:number;homeTeamId:number;awayTeamId:number;startsAt:Date;home:string;away:string}>(`SELECT g.provider_id::int AS "providerId",g.home_team_id AS "homeTeamId",g.away_team_id AS "awayTeamId",g.starts_at AS "startsAt",h.abbreviation AS home,a.abbreviation AS away FROM games g JOIN teams h ON h.league=g.league AND h.provider_id=g.home_team_id JOIN teams a ON a.league=g.league AND a.provider_id=g.away_team_id WHERE g.league='nba' AND (g.home_team_id=10 OR g.away_team_id=10)`);
      const checkedAt = new Date().toISOString(); let matched=0;
      for (const item of snapshots) {
        const matches=stored.rows.filter(game => game.home===item.home && game.away===item.away && game.startsAt?.getTime()===Date.parse(item.startsAt));
        if(matches.length!==1) continue;
        const game=matches[0];
        const payload: ReviewedMedia={league:'nba',providerId:game.providerId,homeTeamId:game.homeTeamId,awayTeamId:game.awayTeamId,startsAt:item.startsAt,verifiedAt:checkedAt,sourceUrl:WARRIORS_SCHEDULE_URL,broadcasts:item.broadcasts,highlight:null};
        await client.query(`INSERT INTO official_broadcasts(league,provider_id,nba_game_id,payload,checked_at,expires_at) VALUES('nba',$1,$4,$2::jsonb,$3,$3::timestamptz+interval '24 hours') ON CONFLICT(league,provider_id) DO UPDATE SET nba_game_id=EXCLUDED.nba_game_id,payload=EXCLUDED.payload,checked_at=EXCLUDED.checked_at,expires_at=EXCLUDED.expires_at`,[game.providerId,JSON.stringify(payload),checkedAt,item.nbaGameId]);
        matched++;
      }
      // A complete source snapshot no longer lists these matchups: retire old listings now.
      await client.query(`UPDATE official_broadcasts SET expires_at=now() WHERE checked_at<$1::timestamptz`,[checkedAt]);
      await client.query(`UPDATE broadcast_sync_state SET last_success_at=now(),last_error_code=NULL,consecutive_failures=0,next_check_at=now()+interval '15 minutes' WHERE source='nba-warriors'`);
      await client.query('COMMIT');
      console.log(JSON.stringify({event:'warriors_broadcasts_synced',sourceGames:snapshots.length,matched}));
    } catch(error) { await client.query('ROLLBACK'); throw error; }
  } catch(error) {
    if(signal.aborted) return false;
    const failure=error instanceof BroadcastFailure?error:new BroadcastFailure('BROADCAST_STORAGE');
    const delay=Math.max(failure.retryMs,Math.min(21600_000,900_000*2**Math.min(due.rows[0].failures,5)));
    await client.query(`UPDATE broadcast_sync_state SET last_error_code=$1,consecutive_failures=consecutive_failures+1,next_check_at=now()+$2::int*interval '1 millisecond' WHERE source='nba-warriors'`,[failure.code,delay]);
    console.error(JSON.stringify({event:'warriors_broadcasts_failed',code:failure.code}));
  }
  return true;
}
