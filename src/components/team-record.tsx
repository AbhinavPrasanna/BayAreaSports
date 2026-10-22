import type { FreeLeague, StoredGame } from '../shared/games';
import { recordLabel, seasonLabel, type CurrentTeamRecord } from '../shared/records';

export function CurrentRecord({ record, league, hidden }: {record?:CurrentTeamRecord;league:FreeLeague;hidden:boolean}) {
  if(hidden) return <span className="team-records muted-record">Record hidden</span>;
  if(!record) return <span className="team-records muted-record">Record loading…</span>;
  const playoff=record.playoffs && record.playoffs.wins+record.playoffs.losses+record.playoffs.ties>0;
  return <span className="team-records" title={record.checkedAt?`Season data checked ${new Date(record.checkedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})} PT`:undefined}>
    <span>{record.regular?`${seasonLabel(league,record.season)} · ${recordLabel(record.regular,league)}`:'Season record loading…'}</span>
    {playoff&&<span>Playoffs {recordLabel(record.playoffs!,league)}</span>}
    {record.delayed&&<span className="delayed-text">Record update delayed</span>}
  </span>;
}
export function EnteringRecord({ game, home, hidden }: {game:StoredGame;home:boolean;hidden:boolean}) {
  if(hidden) return <span className="game-record muted-record">Record hidden</span>;
  const records=game.records, tally=home?records?.homeBefore:records?.awayBefore;
  if(!records||!tally) return <span className="game-record muted-record">Record pending</span>;
  return <span className={`game-record${records.delayed?' delayed-text':''}`} title={`${seasonLabel(game.league,records.season)} ${records.phase==='regular'?'regular season':'playoffs'} record entering this game${records.delayed?' · update delayed':''}`}>
    {records.phase==='playoffs'?'Playoffs':'Season'} {recordLabel(tally,game.league)} entering{records.delayed?' · delayed':''}
  </span>;
}
export function AfterGameRecords({ game, hidden }: {game:StoredGame;hidden:boolean}) {
  const records=game.records;
  if(hidden||game.status!=='final'||!records) return null;
  return <section className="after-game-records" aria-label="Records after this game">
    <h3>After this game <small>{seasonLabel(game.league,records.season)} · {records.phase==='regular'?'Regular season':'Playoffs'}</small></h3>
    <p><span>{game.awayTeam.name}</span><strong>{records.awayAfter?recordLabel(records.awayAfter,game.league):'Pending'}</strong></p>
    <p><span>{game.homeTeam.name}</span><strong>{records.homeAfter?recordLabel(records.homeAfter,game.league):'Pending'}</strong></p>
    {records.delayed&&<small className="delayed-text">Season record update delayed</small>}
  </section>;
}
