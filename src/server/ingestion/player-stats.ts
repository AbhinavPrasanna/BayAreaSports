import type { PoolClient } from 'pg';
import type { FreeLeague } from '../../shared/games';
import type { PlayerGameStats } from '../../shared/advanced-game';
import type { SportsProvider } from '../providers/types';
import { reserveRequest } from './scheduler';
import { failurePolicy } from './policy';

interface GameScope {providerId:number;homeTeamId:number;awayTeamId:number;}
export interface PlayerStatsProvider extends SportsProvider {getPlayerStats(game:GameScope,cursor:number|undefined,signal?:AbortSignal):Promise<{players:PlayerGameStats[];nextCursor:number|null}>;}
export async function configurePlayerStats(client:PoolClient,enabled:FreeLeague[]){
  await client.query('UPDATE player_stats_access SET enabled=(league=ANY($1::text[]))',[enabled]);
}
export async function syncNextPlayerStats(client:PoolClient,providers:PlayerStatsProvider[],enabled:FreeLeague[],signal:AbortSignal){
  if(!enabled.length||signal.aborted)return false;
  const gate=await client.query("UPDATE player_stats_gate SET next_check_at=now()+interval '60 seconds' WHERE singleton AND next_check_at<=now() RETURNING singleton");
  if(!gate.rows.length)return false;
  await client.query(`INSERT INTO game_player_stats(league,provider_id) SELECT league,provider_id FROM games
    WHERE league=ANY($1::text[]) AND status IN ('in_progress','suspended','final') AND starts_at>=now()-interval '31 days' ON CONFLICT DO NOTHING`,[enabled]);
  const result=await client.query<{league:FreeLeague;game:GameScope;failures:number;populated:boolean}>(`SELECT g.league,json_build_object('providerId',g.provider_id,'homeTeamId',g.home_team_id,'awayTeamId',g.away_team_id) AS game,s.consecutive_failures AS failures,jsonb_array_length(COALESCE(s.payload,'[]'::jsonb))>0 AS populated
    FROM game_player_stats s JOIN games g USING(league,provider_id) WHERE g.league=ANY($1::text[]) AND s.next_sync_at<=now() AND g.status IN ('in_progress','suspended','final') AND g.starts_at>=now()-interval '31 days'
    ORDER BY (g.status='in_progress') DESC,s.next_sync_at,g.starts_at DESC LIMIT 1`,[enabled]);
  const state=result.rows[0];if(!state)return false;
  const provider=providers.find(p=>p.league===state.league);if(!provider)return false;
  await client.query('UPDATE game_player_stats SET last_attempt_at=now() WHERE league=$1 AND provider_id=$2',[state.league,state.game.providerId]);
  try {
    const players=new Map<string,PlayerGameStats>(),seen=new Set<number>();let cursor:number|undefined;
    for(let i=0;;i++){
      if(i>=4)throw new Error('Player statistics pagination limit');
      await reserveRequest(client,signal);signal.throwIfAborted();
      const page=await provider.getPlayerStats(state.game,cursor,signal);
      for(const row of page.players)players.set(row.teamId+':'+row.playerId,row);
      if(page.nextCursor===null)break;
      if(seen.has(page.nextCursor))throw new Error('Player statistics cursor loop');
      seen.add(page.nextCursor);cursor=page.nextCursor;
    }
    signal.throwIfAborted();
    if(!players.size&&state.populated)throw new Error('Previously populated player statistics became empty');
    // Publish only complete pages; errors preserve the previous snapshot and checked time.
    await client.query(`UPDATE game_player_stats s SET payload=$3::jsonb,
      checked_at=now(),error_code=NULL,consecutive_failures=0,next_sync_at=now()+CASE WHEN jsonb_array_length($3::jsonb)=0 THEN interval '10 minutes' WHEN g.status='final' THEN interval '6 hours' ELSE interval '60 seconds' END
      FROM games g WHERE s.league=$1 AND s.provider_id=$2 AND g.league=s.league AND g.provider_id=s.provider_id`,[state.league,state.game.providerId,JSON.stringify([...players.values()])]);
    console.log(JSON.stringify({event:'player_stats_synced',league:state.league,players:players.size}));
  }catch(error){
    if(signal.aborted)return false;
    const failure=failurePolicy(error,state.failures+1,60),next=new Date(Date.now()+failure.delayMs);
    // A rejected entitlement pauses the league's jobs; no paid endpoints run at all when disabled.
    const leaguePaused=['HTTP_401','HTTP_403'].includes(failure.code);
    await client.query('UPDATE game_player_stats SET error_code=$3,consecutive_failures=consecutive_failures+1,next_sync_at=$4 WHERE league=$1 AND (provider_id=$2 OR $5::boolean)',[state.league,state.game.providerId,failure.code,next,leaguePaused]);
    if(failure.code==='RATE_LIMITED')await client.query("UPDATE provider_throttle SET next_request_at=GREATEST(next_request_at,$1) WHERE provider='balldontlie'",[next]);
    console.error(JSON.stringify({event:'player_stats_failed',league:state.league,code:failure.code}));
  }
  return true;
}
