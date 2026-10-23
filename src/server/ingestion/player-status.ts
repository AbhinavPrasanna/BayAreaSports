import type {PoolClient} from 'pg';
import type {FreeLeague} from '../../shared/games';
import {combinePlayerStatus,type RosterPlayer,type InjuryReport} from '../../shared/player-status';
import {reserveRequest} from './scheduler';
import {failurePolicy} from './policy';
export interface StatusProvider {league:FreeLeague;getRoster(teamId:number,cursor:number|undefined,signal?:AbortSignal):Promise<{players:RosterPlayer[];nextCursor:number|null}>;getInjuries(teamId:number,cursor:number|undefined,signal?:AbortSignal):Promise<{players:InjuryReport[];nextCursor:number|null}>;}
export async function configurePlayerStatus(client:PoolClient,enabled:FreeLeague[]){
  await client.query(`INSERT INTO team_player_status(league,team_id) SELECT league,provider_id FROM teams WHERE enabled ON CONFLICT DO NOTHING`);
  await client.query('UPDATE team_player_status SET enabled=(league=ANY($1::text[]))',[enabled]);
}
export async function syncNextPlayerStatus(client:PoolClient,providers:StatusProvider[],enabled:FreeLeague[],signal:AbortSignal){
  if(!enabled.length||signal.aborted)return false;
  const gate=await client.query("UPDATE player_status_gate SET next_check_at=now()+interval '60 seconds' WHERE singleton AND next_check_at<=now() RETURNING singleton");if(!gate.rows.length)return false;
  const due=await client.query<{league:FreeLeague;teamId:number;failures:number}>(`SELECT league,team_id AS "teamId",consecutive_failures AS failures FROM team_player_status WHERE enabled AND league=ANY($1::text[]) AND next_sync_at<=now() ORDER BY next_sync_at,league LIMIT 1`,[enabled]);
  const team=due.rows[0];if(!team)return false;
  const provider=providers.find(p=>p.league===team.league);if(!provider)return false;
  await client.query('UPDATE team_player_status SET last_attempt_at=now() WHERE league=$1 AND team_id=$2',[team.league,team.teamId]);
  try{
    async function collect<T extends RosterPlayer>(fetchPage:(cursor:number|undefined)=>Promise<{players:T[];nextCursor:number|null}>){
      const rows:T[]=[],seen=new Set<number>();let cursor:number|undefined;
      for(let page=0;;page++){
        if(page>=4)throw new Error('Player-status pagination limit');
        await client.query("INSERT INTO worker_heartbeats(worker_name,last_seen_at) VALUES('scheduler',now()) ON CONFLICT(worker_name) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at");
        await reserveRequest(client,signal);signal.throwIfAborted();
        const result=await fetchPage(cursor);for(const row of result.players){if(row.teamId!==team.teamId)throw new Error('Player-status team mismatch');rows.push(row);}
        if(result.nextCursor===null)break;
        if(seen.has(result.nextCursor))throw new Error('Player-status cursor loop');seen.add(result.nextCursor);cursor=result.nextCursor;
      }
      return rows;
    }
    const roster=await collect(cursor=>provider.getRoster(team.teamId,cursor,signal));
    const injuries=await collect(cursor=>provider.getInjuries(team.teamId,cursor,signal));
    const players=combinePlayerStatus(roster,injuries);signal.throwIfAborted();
    await client.query(`UPDATE team_player_status SET payload=$3::jsonb,checked_at=now(),error_code=NULL,consecutive_failures=0,next_sync_at=now()+interval '10 minutes' WHERE league=$1 AND team_id=$2`,[team.league,team.teamId,JSON.stringify(players)]);
    console.log(JSON.stringify({event:'player_status_synced',league:team.league,players:players.length}));
  }catch(error){
    if(signal.aborted)return false;
    const failure=failurePolicy(error,team.failures+1,60),next=new Date(Date.now()+failure.delayMs);
    await client.query('UPDATE team_player_status SET error_code=$3,consecutive_failures=consecutive_failures+1,next_sync_at=$4 WHERE league=$1 AND team_id=$2',[team.league,team.teamId,failure.code,next]);
    if(failure.code==='RATE_LIMITED')await client.query("UPDATE provider_throttle SET next_request_at=GREATEST(next_request_at,$1) WHERE provider='balldontlie'",[next]);
    console.error(JSON.stringify({event:'player_status_failed',league:team.league,code:failure.code}));
  }
  return true;
}
