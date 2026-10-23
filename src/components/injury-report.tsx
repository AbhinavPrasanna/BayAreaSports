'use client';
import type {FreeLeague} from '../shared/games';
import type {TeamPlayerStatus} from '../shared/player-status';
import {PlayerStatusReport} from './player-status';
import {useSnapshot} from './use-snapshot';
import {RefreshIcon} from './game-ui';

export function InjuryReport({leagues,hidden,ready,refreshVersion,onRefresh,onToggleProtection}:{leagues:FreeLeague[];hidden:boolean;ready:boolean;refreshVersion:number;onRefresh:()=>void;onToggleProtection:()=>void}){
  const feed=useSnapshot<{data:TeamPlayerStatus[]}>(ready&&leagues.length?'/api/player-status':null,refreshVersion);
  const teams=feed.data?.data.filter(team=>leagues.includes(team.league));
  return <section id="injury-report" className="injury-report-section" aria-labelledby="injury-report-heading" data-refresh-count={feed.sequence}>
    <div className="section-title-row"><div><p className="eyebrow">ROSTERS &amp; PLAYER STATUS</p><h2 id="injury-report-heading">Injury Report<span className="orange-dot">.</span></h2></div><button className="refresh-button" aria-label="Refresh injury reports" title="Refresh saved reports" onClick={onRefresh} disabled={feed.refreshing}><RefreshIcon spinning={feed.refreshing}/></button></div>
    <p className="injury-intro">Your teams, beyond the scoreboard. Browse current rosters, reported injuries and return estimates.</p>
    <div className="fan-actions"><button className={`spoiler-toggle${hidden?' enabled':''}`} aria-pressed={hidden} onClick={onToggleProtection}>{hidden?'Scores hidden':'Hide scores'}</button><span>{hidden?'Reports stay hidden until you reveal them.':'Spoiler protection, when you need it.'}</span></div>
    {feed.error&&<div className="notice error-notice" role="alert">We couldn’t refresh player reports. {feed.data?'Your last saved reports remain below.':'Please check your connection.'} Updates retry automatically. <button onClick={onRefresh}>Try again ↗</button></div>}
    {!ready?<p role="status">Loading your teams…</p>:!leagues.length?<div className="empty-state"><h3>Choose your teams.</h3><p>Use Choose teams above to follow a team and see its current roster and injury report.</p></div>:!feed.data?<p role="status">{feed.error?'Player reports are unavailable right now.':'Loading current rosters and reports…'}</p>:<div className="injury-report-card"><PlayerStatusReport key={`${hidden}:${leagues.join(',')}`} teams={teams} hidden={hidden}/></div>}
    <div className="scoreboard-footnote"><span aria-hidden="true">↻</span><p>Refreshes every 15 seconds while visible and when you reconnect.<br/><span>Team reports are checked about every 10 minutes. Data provided by BALLDONTLIE.</span></p></div>
  </section>;
}
