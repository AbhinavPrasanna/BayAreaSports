import type { Pool } from 'pg';
import type { NormalizedGame, FreeLeague } from '../../shared/games';
import type { RecordDataset, RecordPhase } from '../../shared/records';

export async function readRecordBook(pool: Pick<Pool,'query'>): Promise<RecordDataset[]> {
  const result=await pool.query<{league:FreeLeague;season:number;phase:RecordPhase;ready:boolean;checkedAt:Date|null;error:string|null;game:NormalizedGame|null;live:Partial<NormalizedGame>|null}>(`SELECT s.league,s.season,s.phase,s.published_generation IS NOT NULL AS ready,s.last_success_at AS "checkedAt",s.last_error_code AS error,
    r.payload AS game,CASE WHEN g.observed_at>r.observed_at THEN json_build_object('providerId',g.provider_id,'homeTeamId',g.home_team_id,'awayTeamId',g.away_team_id,
      'homeScore',g.home_score,'awayScore',g.away_score,'status',g.status,'startsAt',g.starts_at,'calendarDate',to_char(g.calendar_date,'YYYY-MM-DD')) ELSE NULL END AS live
    FROM record_sync s LEFT JOIN record_games r ON r.league=s.league AND r.season=s.season AND r.phase=s.phase AND r.generation=s.published_generation
    LEFT JOIN games g ON g.league=r.league AND g.provider_id=r.provider_id
    WHERE s.season >= EXTRACT(YEAR FROM now())::integer-2 ORDER BY s.league,s.season,s.phase`);
  const book=new Map<string,RecordDataset>();
  for(const row of result.rows) {
    const key=`${row.league}:${row.season}:${row.phase}`;
    let dataset=book.get(key);
    if(!dataset) { dataset={league:row.league,season:row.season,phase:row.phase,ready:row.ready,checkedAt:row.checkedAt?.toISOString()??null,delayed:!!row.error||!!row.checkedAt&&Date.now()-row.checkedAt.getTime()>6*3600_000,games:[]};book.set(key,dataset); }
    if(row.game) dataset.games.push({...row.game,...row.live});
  }
  return [...book.values()];
}
