import type {Pool} from 'pg';
import type {FreeLeague} from '../../shared/games';
import type {PlayerStatus,TeamPlayerStatus} from '../../shared/player-status';
export async function readTeamPlayerStatus(pool:Pick<Pool,'query'>,league:FreeLeague,teamIds:number[]):Promise<TeamPlayerStatus[]>{
  const result=await pool.query<{teamId:number;teamName:string;enabled:boolean;players:PlayerStatus[]|null;checkedAt:Date|null;error:string|null}>(`SELECT s.team_id AS "teamId",t.name AS "teamName",s.enabled,s.payload AS players,s.checked_at AS "checkedAt",s.error_code AS error
    FROM team_player_status s JOIN teams t ON t.league=s.league AND t.provider_id=s.team_id
    WHERE s.league=$1 AND s.team_id=ANY($2::integer[]) AND t.enabled ORDER BY t.name`,[league,teamIds]);
  return result.rows.map(row=>({league,teamId:row.teamId,teamName:row.teamName,
    status:!row.enabled?'disabled':!row.players?(row.error?'unavailable':'pending'):row.error||!row.checkedAt||Date.now()-row.checkedAt.getTime()>30*60_000?'delayed':'ready',
    checkedAt:row.enabled?row.checkedAt?.toISOString()??null:null,players:row.enabled?row.players??[]:[]}));
}
