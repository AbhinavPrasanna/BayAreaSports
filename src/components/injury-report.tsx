'use client';
import {useState} from 'react';
import type {TeamPlayerStatus} from '../shared/player-status';
import {PlayerStatusReport} from './player-status';
import {useSnapshot} from './use-snapshot';
import {RefreshIcon,TeamMark} from './game-ui';

export function InjuryReport({hidden,ready,refreshVersion,onRefresh,onToggleProtection}:{hidden:boolean;ready:boolean;refreshVersion:number;onRefresh:()=>void;onToggleProtection:()=>void}){
  const [selectedTeam,setSelectedTeam]=useState<'nba'|'nfl'>('nba');
  const feed=useSnapshot<{data:TeamPlayerStatus[]}>(ready?'/api/player-status':null,refreshVersion);
  const teams=feed.data?.data.filter(team=>team.league===selectedTeam);
  return <section id="injury-report" className="injury-report-section" aria-labelledby="injury-report-heading" data-refresh-count={feed.sequence}>
    <div className="section-title-row"><div><p className="eyebrow">ROSTERS &amp; PLAYER STATUS</p><h2 id="injury-report-heading">Injury Report<span className="orange-dot">.</span></h2></div><button className="refresh-button" aria-label="Refresh injury reports" title="Refresh saved reports" onClick={onRefresh} disabled={feed.refreshing}><RefreshIcon spinning={feed.refreshing}/></button></div>
    <p className="injury-intro">Choose your team to browse its current roster, reported injuries and return estimates.</p>
    <div className="injury-team-selector" role="group" aria-label="Injury report team">{([['nba','Warriors','NBA'],['nfl','49ers','NFL']] as const).map(([league,name,sport])=><button key={league} type="button" aria-label={`${name} injury report`} aria-pressed={selectedTeam===league} onClick={()=>setSelectedTeam(league)}><TeamMark league={league}/><span><strong>{name}</strong><small>{sport}</small></span></button>)}</div>
    <div className="fan-actions"><button className={`spoiler-toggle${hidden?' enabled':''}`} aria-pressed={hidden} onClick={onToggleProtection}>{hidden?'Scores hidden':'Hide scores'}</button><span>{hidden?'Reports stay hidden until you reveal them.':'Spoiler protection, when you need it.'}</span></div>
    {feed.error&&<div className="notice error-notice" role="alert">We couldn’t refresh player reports. {feed.data?'Your last saved reports remain below.':'Please check your connection.'} Updates retry automatically. <button onClick={onRefresh}>Try again ↗</button></div>}
    {!ready?<p role="status">Loading player reports…</p>:!feed.data?<p role="status">{feed.error?'Player reports are unavailable right now.':'Loading current rosters and reports…'}</p>:<div className="injury-report-card"><PlayerStatusReport key={`${hidden}:${selectedTeam}`} teams={teams} hidden={hidden}/></div>}
    <div className="scoreboard-footnote"><span aria-hidden="true">↻</span><p>Refreshes every 15 seconds while visible and when you reconnect.<br/><span>Team reports are checked about every 10 minutes. Data provided by BALLDONTLIE.</span></p></div>
  </section>;
}
