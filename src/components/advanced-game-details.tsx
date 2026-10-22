import type { StoredGame } from '../shared/games';
import type { PlayerGameStats } from '../shared/advanced-game';
import { showScores } from '../shared/scoreboard';

type Column={label:string;key:string;denominator?:string};
const basketball:Column[]=[{label:'MIN',key:'min'},{label:'PTS',key:'pts'},{label:'REB',key:'reb'},{label:'AST',key:'ast'},{label:'STL',key:'stl'},{label:'BLK',key:'blk'},{label:'FG',key:'fgm',denominator:'fga'},{label:'3PT',key:'fg3m',denominator:'fg3a'},{label:'FT',key:'ftm',denominator:'fta'},{label:'TO',key:'turnover'}];
const football:{name:string;columns:Column[]}[]=[
  {name:'Passing',columns:[{label:'C/ATT',key:'passing_completions',denominator:'passing_attempts'},{label:'YDS',key:'passing_yards'},{label:'TD',key:'passing_touchdowns'},{label:'INT',key:'passing_interceptions'}]},
  {name:'Rushing',columns:[{label:'CAR',key:'rushing_attempts'},{label:'YDS',key:'rushing_yards'},{label:'TD',key:'rushing_touchdowns'}]},
  {name:'Receiving',columns:[{label:'REC',key:'receptions'},{label:'TGT',key:'receiving_targets'},{label:'YDS',key:'receiving_yards'},{label:'TD',key:'receiving_touchdowns'}]},
  {name:'Defense',columns:[{label:'TOT',key:'total_tackles'},{label:'SOLO',key:'solo_tackles'},{label:'SACK',key:'defensive_sacks'},{label:'INT',key:'defensive_interceptions'}]},
  {name:'Kicking',columns:[{label:'FGM',key:'field_goals_made'},{label:'FGA',key:'field_goal_attempts'},{label:'XPM',key:'extra_points_made'}]},
];
const value=(input:number|string|null|undefined)=>input??'—';
function StatsTable({caption,players,columns}:{caption:string;players:PlayerGameStats[];columns:Column[]}){
  return <div className="stats-scroll" role="region" aria-label={caption} tabIndex={0}><table className="stats-table"><caption>{caption}</caption><thead><tr><th scope="col">Player</th>{columns.map(c=><th scope="col" key={c.key}>{c.label}</th>)}</tr></thead><tbody>{players.map(p=><tr key={p.playerId}><th scope="row">{p.name}{p.position&&<small>{p.position}</small>}</th>{columns.map(c=><td key={c.key}>{c.denominator?`${value(p.values[c.key])}/${value(p.values[c.denominator])}`:value(p.values[c.key])}</td>)}</tr>)}</tbody></table></div>;
}
function PlayerStatistics({game}:{game:StoredGame}){
  const snapshot=game.playerStats;
  if(!snapshot||!snapshot.players.length)return <p className="advanced-note">{snapshot?.status==='disabled'?'Player statistics aren’t available in this app yet.':snapshot?.status==='unavailable'?'Player statistics are temporarily unavailable.':'Player statistics haven’t been reported yet.'}</p>;
  return <>{snapshot.status==='delayed'&&<p className="advanced-note delayed-text">Player-stat updates are delayed. Showing the last saved statistics.</p>}{snapshot.checkedAt&&<p className="advanced-note">Last checked <time dateTime={snapshot.checkedAt}>{new Date(snapshot.checkedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} PT</time></p>}
    {[game.awayTeam,game.homeTeam].map(team=>{
      const players=snapshot.players.filter(p=>p.teamId===team.providerId);
      return <section className="player-team" key={team.providerId}><h4>{team.name}</h4>{!players.length?<p className="advanced-note">No player statistics reported for this team.</p>:game.league!=='nfl'?<StatsTable caption={`${team.name} player statistics`} players={players} columns={basketball}/>:football.map(group=>{
        const rows=players.filter(p=>group.columns.some(c=>(p.values[c.denominator??c.key]??null)!==null));
        return rows.length?<StatsTable key={group.name} caption={`${team.name} · ${group.name}`} players={rows} columns={group.columns}/>:null;
      })}</section>;
    })}<p className="advanced-note">— Not reported. Swipe tables horizontally for more columns.</p></>;
}
export function AdvancedGameDetails({game,hidden}:{game:StoredGame;hidden:boolean}){
  if(game.league==='wnba')return null;
  const hasStarted=showScores(game.status),protectedStats=hidden;
  return <details className="advanced-details"><summary><span>Advanced details<small>Quarter scores · Player stats</small></span><span aria-hidden="true">+</span></summary><div className="advanced-body">
    {protectedStats?<p className="advanced-note">{hasStarted?'Spoiler protection is on. Reveal this game’s score to view quarter scores and player statistics.':'Spoiler protection is on. Game statistics will stay hidden until you reveal the score after play begins.'}</p>:<>
      <section aria-label="Quarter scores"><h3>Quarter scores</h3>{!hasStarted?<p className="advanced-note">Quarter scores will appear once the game is underway.</p>:!game.lineScore?<p className="advanced-note">Quarter scores aren’t available for this game.</p>:<>
        <div className="stats-scroll" role="region" aria-label="Quarter score breakdown" tabIndex={0}><table className="stats-table quarter-table"><caption className="sr-only">Points by quarter for both teams</caption><thead><tr><th scope="col">Team</th>{game.lineScore.periods.map(p=><th scope="col" key={p.label}>{p.label}</th>)}<th scope="col">Total</th></tr></thead><tbody>{([['away',game.awayTeam,game.awayScore],['home',game.homeTeam,game.homeScore]] as const).map(([side,team,total])=><tr key={side}><th scope="row" title={team.name??undefined}>{team.abbreviation??team.name}</th>{game.lineScore!.periods.map(p=><td key={p.label}>{value(p[side])}</td>)}<td><strong>{value(total)}</strong></td></tr>)}</tbody></table></div>
        {game.status==='final'&&!game.lineScore.complete&&<p className="advanced-note">Some quarter scores are incomplete or awaiting a correction.</p>}
      </>}</section><section aria-label="Player statistics"><h3>Player statistics</h3>{hasStarted||game.playerStats?.status==='disabled'?<PlayerStatistics game={game}/>:<p className="advanced-note">Player statistics haven’t been reported for this game.</p>}</section>
    </>}
  </div></details>;
}
