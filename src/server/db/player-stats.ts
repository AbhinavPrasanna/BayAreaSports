import type { Pool } from 'pg';
import type { FreeLeague } from '../../shared/games';
import type { PlayerGameStats, PlayerStatsSnapshot } from '../../shared/advanced-game';

export async function readPlayerStats(pool:Pick<Pool,'query'>,league:FreeLeague,id:number):Promise<PlayerStatsSnapshot> {
  const result=await pool.query<{enabled:boolean;players:PlayerGameStats[]|null;checkedAt:Date|null;error:string|null}>(`SELECT a.enabled,s.payload AS players,s.checked_at AS "checkedAt",s.error_code AS error
    FROM player_stats_access a LEFT JOIN game_player_stats s ON s.league=a.league AND s.provider_id=$2 WHERE a.league=$1`,[league,id]);
  const row=result.rows[0];
  if(!row?.enabled)return {status:'disabled',players:[],checkedAt:null};
  const checkedAt=row.checkedAt?.toISOString()??null;
  if(!row.players)return {status:row.error?'unavailable':'pending',players:[],checkedAt};
  return {status:row.error||!!row.checkedAt&&Date.now()-row.checkedAt.getTime()>8*3600_000?'delayed':'ready',players:row.players,checkedAt};
}
