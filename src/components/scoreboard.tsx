'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { addDays, FUTURE_DAYS, HISTORY_DAYS, pacificDate } from '@/shared/dates';
import { type FreeLeague, type GamesResponse, type StoredGame } from '@/shared/games';
import { defaultPreferences, gameKey, nextGameForTeam, parsePreferences, PREFERENCES_KEY, type FanPreferences } from '@/shared/fan-preferences';
import { ageLabel } from '@/shared/scoreboard';
import { Arrow, BrandIcon, checkLabel, formatDay, formatTime, GameCard, RefreshIcon, TeamMark, teamInfo } from './game-ui';
import { GameDetails } from './game-details';
import { PreferencesDialog } from './preferences-dialog';
import { useSnapshot } from './use-snapshot';

type LeagueFilter = FreeLeague | 'all';
type View = 'today' | 'all' | 'results' | 'live';
function weekStart(day: string) { const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); return addDays(day, -(weekday === 0 ? 6 : weekday - 1)); }

export function Scoreboard() {
  const [today, setToday] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [league, setLeague] = useState<LeagueFilter>('all');
  const [view, setView] = useState<View>('today');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<FanPreferences>(defaultPreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [temporaryPreferences, setTemporaryPreferences] = useState(false);
  const [manageTeams, setManageTeams] = useState(false);
  const preferencesTrigger = useRef<HTMLButtonElement | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [selectedGame, setSelectedGame] = useState<StoredGame | null>(null);
  const detailsTrigger = useRef<HTMLButtonElement | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    try { setPreferences(parsePreferences(localStorage.getItem(PREFERENCES_KEY))); }
    catch { setTemporaryPreferences(true); }
    setPreferencesReady(true);
    const syncPreferences = (event: StorageEvent) => { if (event.key === PREFERENCES_KEY) { setPreferences(parsePreferences(event.newValue)); setRevealed(new Set()); } };
    window.addEventListener('storage', syncPreferences);
    return () => window.removeEventListener('storage', syncPreferences);
  }, []);
  useEffect(() => {
    if (!preferencesReady) return;
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); setTemporaryPreferences(false); }
    catch { setTemporaryPreferences(true); }
  }, [preferences, preferencesReady]);
  useEffect(() => {
    const tick = () => { const day = pacificDate(); setToday(day); setNow(Date.now()); setAnchor(value => value ?? weekStart(day)); };
    tick(); const timer = setInterval(tick, 15_000); return () => clearInterval(timer);
  }, []);

  const activeLeague = league === 'all' || preferences.leagues.includes(league) ? league : 'all';
  const displayedLeagues = activeLeague === 'all' ? preferences.leagues : [activeLeague];
  const from = today && anchor ? view === 'today' ? today : view === 'results' ? addDays(today, -29) : view === 'live' ? addDays(today, -1) : anchor : null;
  const to = today && anchor ? view === 'today' || view === 'results' ? today : view === 'live' ? addDays(today, 1) : addDays(anchor, 6) : null;
  const query = preferencesReady && displayedLeagues.length && from && to ? new URLSearchParams({ league: activeLeague, view: view === 'today' ? 'all' : view, from, to }).toString() : null;
  const futureQuery = preferencesReady && preferences.leagues.length && today ? new URLSearchParams({ league: 'all', view: 'all', from: today, to: addDays(today, FUTURE_DAYS) }).toString() : null;
  const feed = useSnapshot<GamesResponse>(query ? `/api/games?${query}` : null, refreshVersion);
  const nextFeed = useSnapshot<GamesResponse>(futureQuery ? `/api/games?${futureQuery}` : null, refreshVersion);
  const response = feed.data;
  const games = (response?.data ?? []).filter(game => displayedLeagues.includes(game.league) && (!selectedDay || view !== 'all' || game.localDate === selectedDay));
  if (view === 'results') games.sort((a, b) => b.localDate.localeCompare(a.localDate) || (b.startsAt ?? '').localeCompare(a.startsAt ?? ''));
  const days = [...new Set(games.map(game => game.localDate))];
  const states = (response?.sync.leagues ?? nextFeed.data?.sync.leagues ?? []).filter(state => displayedLeagues.includes(state.league));
  const firstSync = states.some(state => !state.lastSuccessAt && !state.lastErrorCode);
  const syncError = states.some(state => state.lastErrorCode);
  const workerSeen = response?.sync.workerLastSeenAt ?? nextFeed.data?.sync.workerLastSeenAt;
  const workerStale = Boolean(response && (!workerSeen || now - Date.parse(workerSeen) > 180_000));
  const stale = states.some(state => state.lastSuccessAt && now - Date.parse(state.lastSuccessAt) > 180_000);
  const lastSuccess = states.map(state => state.lastSuccessAt).filter((value): value is string => value !== null).sort()[0] ?? null;
  const pending = !preferencesReady || Boolean(query && !response && !feed.error);
  const heading = view === 'today' ? activeLeague === 'all' ? 'Today in the Bay' : `${teamInfo[activeLeague].short} today` : activeLeague === 'all' ? 'Around the Bay' : `${teamInfo[activeLeague].short} ${view === 'results' ? 'results' : 'games'}`;

  function changeLeague(next: LeagueFilter) { setLeague(next); setSelectedDay(null); }
  function changeView(next: View) { setView(next); setSelectedDay(null); }
  function updatePreferences(next: FanPreferences) { setPreferences(next); if (league !== 'all' && !next.leagues.includes(league)) setLeague('all'); if (next.hideScores !== preferences.hideScores) setRevealed(new Set()); }
  function reveal(game: StoredGame) { setRevealed(previous => { const next = new Set(previous); const key = gameKey(game); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  function hideScore(game: StoredGame) { return preferences.hideScores && !revealed.has(gameKey(game)); }
  function openGame(game: StoredGame, trigger: HTMLButtonElement) { detailsTrigger.current = trigger; setSelectedGame(game); }
  function openPreferences(trigger: HTMLButtonElement) { preferencesTrigger.current = trigger; setManageTeams(true); }

  return <>
    <header className="site-header"><a className="brand" href="#" aria-label="Bayline home"><BrandIcon /><span>BAYLINE<span className="brand-dot">.</span></span></a><nav aria-label="Main navigation"><a className="current" href="#scoreboard">Scoreboard</a><a href="#your-teams">Your teams</a></nav><span className="header-caption"><span className="tiny-dot" /> Made for the Bay</span></header>
    <div className="app-shell">
      <aside className="sidebar" id="your-teams"><p className="eyebrow">YOUR LINEUP</p><button className={`all-teams${activeLeague === 'all' ? ' selected' : ''}`} onClick={() => changeLeague('all')} aria-pressed={activeLeague === 'all'}><span className="all-teams-icon">✳</span> My teams <span className="team-count">{preferences.leagues.length}</span></button>
        <div className="team-nav">{preferences.leagues.map(sport => { const state = (response ?? nextFeed.data)?.sync.leagues.find(item => item.league === sport); return <button key={sport} className={`team-nav-button${activeLeague === sport ? ' selected' : ''}`} onClick={() => changeLeague(activeLeague === sport ? 'all' : sport)} aria-pressed={activeLeague === sport}><TeamMark league={sport} /><span><strong>{teamInfo[sport].short}</strong><small>{teamInfo[sport].city} · {sport.toUpperCase()}</small><span className={`team-check${state?.lastErrorCode ? ' delayed-text' : ''}`}>{state?.lastErrorCode ? 'Update delayed' : ageLabel(state?.lastSuccessAt ?? null, now)}</span></span></button>; })}</div>
        <button className="manage-teams" onClick={event => openPreferences(event.currentTarget)}>Choose teams <span aria-hidden="true">＋</span></button>
        <div className="later-teams"><p className="eyebrow">ON THE HORIZON</p><div><span className="later-icon">SJ</span><span>Sharks<small>NHL · Coming later</small></span></div><div><span className="later-icon">SJ</span><span>Earthquakes<small>MLS · Coming later</small></span></div></div><div className="sidebar-note"><span className="compass-icon">↗</span><p>Different jerseys.<br /><strong>Same side of the Bay.</strong></p></div>
      </aside>
      <main className="main-content">
        <section className="hero"><div><p className="eyebrow hero-kicker"><span /> A LITTLE HOMETOWN ADVANTAGE</p><h1>Your teams.<br /><em>Your game day.</em></h1><p className="hero-description">From the hardwood to the gridiron.<br />Keep up with your corner of the sports world.</p></div><div className="hero-art"><Image src="/images/bayline-hero.png" alt="Golden Gate Bridge at sunset above the 49ers, Warriors, and Valkyries logos" width={1536} height={1024} sizes="(max-width: 540px) 90vw, (max-width: 780px) 40vw, (max-width: 1100px) 28vw, 400px" preload /></div></section>
        <section id="scoreboard" className="scoreboard-section" aria-labelledby="scoreboard-heading" data-refresh-count={feed.sequence} data-last-refresh={feed.checkedAt ?? ''}>
          <div className="section-title-row"><div><p className="eyebrow">THE SCOREBOARD</p><h2 id="scoreboard-heading">{heading}<span className="orange-dot">.</span></h2></div><div className="freshness"><span className={`status-dot${feed.error || syncError || workerStale || stale ? ' warning' : ''}`} /><span>{feed.error ? 'Connection interrupted' : firstSync ? 'First sync in progress' : syncError || workerStale || stale ? 'Updates delayed' : response ? checkLabel(lastSuccess, now) : preferences.leagues.length ? 'Connecting…' : 'Choose your teams'}</span><button className="refresh-button" title="Refresh saved scores" aria-label="Refresh scoreboard" onClick={() => setRefreshVersion(value => value + 1)} disabled={feed.refreshing}><RefreshIcon spinning={feed.refreshing} /></button></div></div>
          <div className="fan-actions"><button className={`spoiler-toggle${preferences.hideScores ? ' enabled' : ''}`} aria-pressed={preferences.hideScores} onClick={() => updatePreferences({ ...preferences, hideScores: !preferences.hideScores })}>{preferences.hideScores ? 'Scores hidden' : 'Hide scores'}</button><span>{preferences.hideScores ? 'Reveal only the games you want.' : 'Spoiler protection, when you need it.'}</span></div>
          {preferencesReady && preferences.leagues.length > 0 && <section className="next-up" aria-labelledby="next-up-title" data-scroll-anchor="next-up"><div className="next-up-heading"><h3 id="next-up-title">Your next games</h3><span>All times Pacific</span></div><div className="next-up-grid">{displayedLeagues.map(sport => {
            const game = today ? nextGameForTeam(nextFeed.data?.data ?? [], sport, now, today) : undefined;
            const target = game?.homeTeamId === ({ nba: 10, nfl: 30, wnba: 13 }[sport]) ? game.awayTeam : game?.homeTeam;
            return <div key={sport} className="next-up-card" data-scroll-anchor={`next-${sport}`}><TeamMark league={sport} small /><div><strong>{teamInfo[sport].short}</strong>{game ? <><span>{game.status === 'in_progress' ? 'Playing now' : `${game.homeTeamId === ({ nba: 10, nfl: 30, wnba: 13 }[sport]) ? 'vs' : 'at'} ${target?.name ?? 'Opponent TBD'}`}</span><small>{game.status === 'in_progress' ? 'Live game' : `${game.localDate === today ? 'Today' : formatDay(game.localDate, { weekday: 'short', month: 'short', day: 'numeric' })} · ${game.startsAt ? `${formatTime(game.startsAt)} PT` : 'Time TBD'}`}</small></> : <span>{nextFeed.error ? 'Next game unavailable' : !nextFeed.data ? 'Checking the schedule…' : 'No upcoming game in the next 30 days'}</span>}</div>{game && <button aria-label={`Next ${teamInfo[sport].short} game details`} onClick={event => openGame(game, event.currentTarget)}><Arrow /></button>}</div>;
          })}</div>{nextFeed.error && <p className="next-up-note">The next-game check will retry automatically.</p>}</section>}
          <div className="scoreboard-toolbar" data-scroll-anchor="view-controls"><div className="view-tabs" aria-label="Game view">{([['today', 'Today'], ['all', 'Schedule'], ['results', 'Results'], ['live', 'Live now']] as const).map(([value, label]) => <button key={value} onClick={() => changeView(value)} aria-pressed={view === value} className={view === value ? 'active' : ''}>{value === 'live' && <i className="live-tab-dot" />}{label}</button>)}</div><span className="timezone-label">PACIFIC TIME</span></div>
          {today && anchor && <div className="calendar-bar" data-scroll-anchor="calendar"><div className="calendar-heading"><div><strong>{view === 'today' ? formatDay(today, { weekday: 'long', month: 'long', day: 'numeric' }) : view === 'results' ? 'The last 30 days' : view === 'live' ? 'In progress now' : `${formatDay(anchor, { month: 'long', day: 'numeric' })} – ${formatDay(addDays(anchor, 6), { month: 'short', day: 'numeric' })}`}</strong><span>{view === 'today' || view === 'all' ? formatDay(today, { year: 'numeric' }) : 'Latest checks'}</span></div>{view === 'all' && <div className="week-actions"><button aria-label="Previous week" disabled={addDays(anchor, -7) < addDays(today, -HISTORY_DAYS)} onClick={() => { setAnchor(addDays(anchor, -7)); setSelectedDay(null); }}><Arrow left /></button><button className="today-button" onClick={() => { setAnchor(weekStart(today)); setSelectedDay(null); }}>This week</button><button aria-label="Next week" disabled={addDays(anchor, 7) > addDays(today, FUTURE_DAYS - 6)} onClick={() => { setAnchor(addDays(anchor, 7)); setSelectedDay(null); }}><Arrow /></button></div>}</div>{view === 'all' && <div className="date-strip"><button className={`week-button${selectedDay === null ? ' selected' : ''}`} onClick={() => setSelectedDay(null)} aria-pressed={selectedDay === null}>Full<br /><strong>week</strong></button>{Array.from({ length: 7 }, (_, i) => addDays(anchor, i)).map(day => <button key={day} className={`${day === today ? 'is-today ' : ''}${selectedDay === day ? 'selected' : ''}`} onClick={() => setSelectedDay(day === selectedDay ? null : day)} aria-pressed={selectedDay === day} aria-label={formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}><span>{formatDay(day, { weekday: 'short' })}</span><strong>{formatDay(day, { day: 'numeric' })}</strong><i /></button>)}</div>}</div>}
          {feed.error && <div className="notice error-notice" role="alert">We couldn’t refresh the scoreboard. {response ? 'Your saved scores are still here.' : 'Check your connection and the local services.'} Updates resume when you reconnect. <button onClick={() => setRefreshVersion(value => value + 1)}>Try again ↗</button></div>}
          {response && (syncError || workerStale || stale) && <div className="notice" role="status">{workerStale ? 'The score updater hasn’t checked in recently.' : syncError ? 'Some team feeds couldn’t be refreshed. They will retry automatically.' : 'The latest check is taking longer than usual.'} Saved games remain visible; scores may be out of date.</div>}
          <div className="games-container" aria-busy={feed.refreshing}>{pending ? <div className="loading-state" role="status"><div className="loading-cards"><div /><div /></div><p>Finding your game day…</p></div> : games.length === 0 ? <div className="empty-state"><span className="empty-symbol" aria-hidden="true">{view === 'live' ? '◉' : '↗'}</span><h3>{!preferences.leagues.length ? 'Make room for your teams.' : feed.error && !response ? 'The scoreboard is taking a timeout.' : firstSync ? 'Your lineup is warming up.' : syncError && !lastSuccess ? 'We’re having trouble checking the schedule.' : view === 'live' ? 'A quiet moment in the Bay.' : view === 'results' ? 'No final scores in this window.' : view === 'today' ? 'No games today. More Bay ahead.' : 'No games on this stretch.'}</h3><p>{!preferences.leagues.length ? 'Choose the teams you follow to see their next games and scores.' : firstSync ? 'The first provider checks are underway. Games will appear automatically.' : view === 'today' ? 'Your next games are listed above. The full schedule has the days ahead.' : view === 'live' ? 'No games are marked in progress in the latest check.' : 'Try another date or team. Coverage depends on the season and available schedules.'}</p>{!preferences.leagues.length ? <button className="text-button" onClick={event => openPreferences(event.currentTarget)}>Choose teams <Arrow /></button> : view === 'today' ? <button className="text-button" onClick={() => changeView('all')}>See the full schedule <Arrow /></button> : activeLeague !== 'all' && <button className="text-button" onClick={() => changeLeague('all')}>See my teams <Arrow /></button>}</div> : days.map(day => <section className="game-day" key={day}><div className="day-heading" data-scroll-anchor={`day-${day}`}><h3>{day === today ? 'Today' : today && day === addDays(today, 1) ? 'Tomorrow' : formatDay(day, { weekday: 'long' })}<span> {formatDay(day, { month: 'short', day: 'numeric' })}</span></h3><span>{games.filter(game => game.localDate === day).length} {games.filter(game => game.localDate === day).length === 1 ? 'game' : 'games'}</span></div><div className="game-grid">{games.filter(game => game.localDate === day).map(game => <GameCard key={gameKey(game)} game={game} now={now} delayed={feed.error || Boolean(states.find(state => state.league === game.league)?.lastErrorCode) || now - Date.parse(game.observedAt) > 180_000} hideScore={hideScore(game)} protection={preferences.hideScores} onReveal={() => reveal(game)} onOpen={openGame} />)}</div></section>)}</div>
          <div className="scoreboard-footnote"><span className="footnote-icon">↻</span><p>Page refreshes every 15 seconds while visible. Provider checks run about once a minute.<br /><span>Clocks reflect the latest check. Data provided by BALLDONTLIE.</span></p></div>
        </section><footer className="page-footer"><span>BAYLINE<span className="orange-dot">.</span></span><p>A home for your hometown teams.</p><span>NBA · NFL · WNBA</span></footer>
      </main>
    </div>
    {selectedGame && <GameDetails key={gameKey(selectedGame)} initial={selectedGame} now={now} refreshVersion={refreshVersion} hideScore={hideScore(selectedGame)} protection={preferences.hideScores} onReveal={() => reveal(selectedGame)} onClose={() => setSelectedGame(null)} trigger={detailsTrigger.current} />}
    {manageTeams && <PreferencesDialog value={preferences} onChange={updatePreferences} onClose={() => setManageTeams(false)} trigger={preferencesTrigger.current} temporary={temporaryPreferences} />}
  </>;
}
