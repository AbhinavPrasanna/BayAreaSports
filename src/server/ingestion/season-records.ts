import type { PoolClient } from 'pg';
import type { SportsProvider, GamePage } from '../providers/types';
import { addDays, pacificDate } from '../../shared/dates';
import { seasonForLeague, type RecordPhase } from '../../shared/records';
import { reserveRequest } from './scheduler';
import { failurePolicy } from './policy';

export interface SeasonProvider extends SportsProvider {
  getSeasonGames(season: number, phase: RecordPhase, endDate: string, cursor: number | undefined, signal?: AbortSignal): Promise<GamePage>;
}
export async function syncNextRecordPage(client: PoolClient, providers: SeasonProvider[], signal: AbortSignal) {
  signal.throwIfAborted();
  const gate = await client.query("UPDATE record_poll_gate SET next_check_at=now()+interval '60 seconds' WHERE singleton AND next_check_at<=now() RETURNING singleton");
  if (!gate.rows.length) return false;
  for (const provider of providers) for (const phase of ['regular','playoffs'] as const)
    await client.query('INSERT INTO record_sync(league,season,phase) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [provider.league,seasonForLeague(provider.league),phase]);
  const due = await client.query<{league: SeasonProvider['league'];season:number;phase:RecordPhase;generation:number;cursor:string|null;seen_cursors:number[];page_count:number;end_date:string|null;consecutive_failures:number}>(`SELECT league,season,phase,generation,cursor,seen_cursors,page_count,to_char(end_date,'YYYY-MM-DD') AS end_date,consecutive_failures
    FROM record_sync WHERE league=ANY($1::text[]) AND next_sync_at<=now() ORDER BY next_sync_at,league,phase LIMIT 1`,[providers.map(p=>p.league)]);
  const state = due.rows[0]; if (!state) return false;
  const provider = providers.find(p=>p.league===state.league)!;
  const endDate = state.end_date ?? addDays(pacificDate(),1);
  try {
    await reserveRequest(client,signal);
    signal.throwIfAborted();
    const page = await provider.getSeasonGames(state.season,state.phase,endDate,state.cursor===null?undefined:Number(state.cursor),signal);
    const next = page.nextCursor;
    if (state.page_count >= 40 || (next !== null && (state.seen_cursors.includes(next) || next === Number(state.cursor)))) throw new Error('Invalid record pagination');
    for (const game of page.games) {
      if (game.league!==state.league || game.season!==state.season || game.recordPhase!==state.phase || (!game.startsAt&&!game.calendarDate)) throw new Error('Record scope mismatch');
    }
    signal.throwIfAborted();
    await client.query('BEGIN');
    try {
      for (const game of page.games) await client.query(`INSERT INTO record_games(league,season,phase,generation,provider_id,payload)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(league,season,phase,generation,provider_id) DO UPDATE SET payload=EXCLUDED.payload,observed_at=now()`,
      [state.league,state.season,state.phase,state.generation,game.providerId,JSON.stringify(game)]);
      if (next !== null) await client.query(`UPDATE record_sync SET cursor=$4,seen_cursors=$5::jsonb,page_count=page_count+1,end_date=$6,next_sync_at=now(),last_error_code=NULL,consecutive_failures=0
        WHERE league=$1 AND season=$2 AND phase=$3`,[state.league,state.season,state.phase,next,JSON.stringify([...state.seen_cursors,next]),endDate]);
      else {
        await client.query(`UPDATE record_sync SET published_generation=generation,generation=generation+1,cursor=NULL,seen_cursors='[]',page_count=0,end_date=NULL,
          next_sync_at=now()+interval '1 hour',last_success_at=now(),last_error_code=NULL,consecutive_failures=0 WHERE league=$1 AND season=$2 AND phase=$3`,[state.league,state.season,state.phase]);
        await client.query('DELETE FROM record_games WHERE league=$1 AND season=$2 AND phase=$3 AND generation<>$4',[state.league,state.season,state.phase,state.generation]);
      }
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    console.log(JSON.stringify({event:'season_records_page',league:state.league,season:state.season,phase:state.phase,games:page.games.length,complete:next===null}));
  } catch(error) {
    if(signal.aborted) return false;
    const failure=failurePolicy(error,state.consecutive_failures+1,60);
    const nextSync=new Date(Date.now()+failure.delayMs);
    await client.query('UPDATE record_sync SET last_error_code=$4,consecutive_failures=consecutive_failures+1,next_sync_at=$5 WHERE league=$1 AND season=$2 AND phase=$3',[state.league,state.season,state.phase,failure.code,nextSync]);
    if(failure.code==='RATE_LIMITED') await client.query("UPDATE provider_throttle SET next_request_at=GREATEST(next_request_at,$1) WHERE provider='balldontlie'",[nextSync]);
    console.error(JSON.stringify({event:'season_records_failed',league:state.league,phase:state.phase,code:failure.code}));
  }
  return true;
}
