'use client';
import {useState} from 'react';
import type {StoredGame} from '../shared/games';
import type {PlayerStatus,TeamPlayerStatus} from '../shared/player-status';
const statusLabel=(player:PlayerStatus)=>player.category==='no_report'?'No reported injury':player.reportedStatus??'Injury reported';
export function PlayerStatusSection({game,hidden}:{game:StoredGame;hidden:boolean}){
  return <details className="player-status-panel"><summary><span>Player status<small>Current roster &amp; injury report</small></span><span aria-hidden="true">+</span></summary><div className="player-status-body">
    <PlayerStatusReport key={String(hidden)} teams={game.playerStatus} hidden={hidden} context={game.status==='final'?'These are current team reports, not injury status on the date of this completed game.':'Availability for this matchup can change before tipoff or kickoff.'}/>
  </div></details>;
}
export function PlayerStatusReport({teams,hidden,context='Current team reports, not a game-day availability guarantee.'}:{teams:TeamPlayerStatus[]|undefined;hidden:boolean;context?:string}){
  const [revealed,setRevealed]=useState(false),[search,setSearch]=useState(''),[filter,setFilter]=useState('all');
  const protectedReport=hidden&&!revealed;
  return <>
    {protectedReport?<><p className="advanced-note">Injury reports can mention recent results. Player names and reports stay hidden until you choose to view them.</p><button className="text-button" onClick={()=>setRevealed(true)}>Show current player status</button><p className="advanced-note">Your game score stays hidden.</p></>:<>
      <p className="advanced-note">Latest reports for your Bay Area teams. “No reported injury” means no injury was listed; it does not confirm fitness or game-day availability.</p>
      <p className="advanced-note">{context}</p>
      {teams?.some(team=>team.players.length>0)&&<div className="player-status-filters"><label>Find a player<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search name or position"/></label><label>Show<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All players</option><option value="reported">Reported injuries</option><option value="no_report">No reported injury</option><option value="available">Reported available</option></select></label></div>}
      {!teams?.length?<p className="advanced-note">Player status is loading. Updates will appear here when available.</p>:teams.map(team=>{
        const rows=team.players.filter(p=>(filter==='all'||p.category===filter)&&`${p.name} ${p.position??''}`.toLowerCase().includes(search.trim().toLowerCase()));
        return <section className="status-team" key={`${team.league}:${team.teamId}`} aria-label={`${team.teamName} player status`} data-scroll-anchor={`status-${team.league}`}><h3>{team.teamName}</h3>
          {team.status==='disabled'?<p className="advanced-note">Roster and injury coverage isn’t enabled for this team with the current data access.</p>:<>
            {team.status==='delayed'&&<p className="advanced-note delayed-text">Updates are delayed. Showing the last saved report.</p>}
            {team.checkedAt&&<p className="advanced-note">Last checked <time dateTime={team.checkedAt}>{new Date(team.checkedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} PT</time></p>}
            {!team.players.length?<p className="advanced-note">{team.status==='unavailable'?'Player status is temporarily unavailable.':'The current roster and injury report haven’t been received yet.'}</p>:<><p className="advanced-note">{team.players.length} players in the provider roster and injury report</p>
              {!rows.length?<p className="advanced-note">No players match these filters.</p>:<ul className="player-status-list">{rows.map(player=><li key={player.playerId}><div className="player-status-heading"><strong>{player.name}<small>{player.position}</small></strong><span className={`status-badge ${player.category}`}>{statusLabel(player)}</span></div>
                {player.description&&<p>{player.description}</p>}
                {player.reportedAt&&<small>Reported {new Date(player.reportedAt).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric'})}</small>}
                {player.returnDate&&<small>Expected return (provider estimate): {player.returnDate}</small>}
              </li>)}</ul>}
            </>}
          </>}
        </section>;
      })}
    </>}
  </>;
}
