import type { FreeLeague, GameTeam, StoredGame } from '@/shared/games';
import { followedTeams } from '@/shared/games';
import { TIME_ZONE } from '@/shared/dates';
import { ageLabel, showScores, statusLabels } from '@/shared/scoreboard';

export const teamInfo = {
  nba: { short: 'Warriors', mark: 'GSW', city: 'Golden State' },
  nfl: { short: '49ers', mark: 'SF', city: 'San Francisco' },
  wnba: { short: 'Valkyries', mark: 'GV', city: 'Golden State' },
};
export const formatDay = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
export const formatTime = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(date));
export function checkLabel(iso: string | null, now: number) {
  const age = ageLabel(iso, now);
  return age === 'Just checked' || !iso ? age : `Checked ${age}`;
}
export function Arrow({ left = false }: { left?: boolean }) { return <svg viewBox="0 0 24 24" aria-hidden="true" className={left ? 'arrow flip' : 'arrow'}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>; }
export function BrandIcon() { return <svg viewBox="0 0 40 40" aria-hidden="true" className="brand-icon"><path d="M7 31V12m26 19V12M3 31h34M7 15c7 15 19 15 26 0M14 24v7m6-5v5m6-7v7M5 12h4m22 0h4" /></svg>; }
export function RefreshIcon({ spinning = false }: { spinning?: boolean }) { return <svg className={spinning ? 'refresh-icon spinning' : 'refresh-icon'} viewBox="0 0 24 24" aria-hidden="true"><path d="M19 9a7 7 0 1 0 0 7M19 4v5h-5" /></svg>; }
export function TeamMark({ league, small = false }: { league: FreeLeague; small?: boolean }) { return <span aria-hidden="true" className={`team-mark ${league}${small ? ' small' : ''}`}>{teamInfo[league].mark}</span>; }
export function isBayTeam(league: FreeLeague, id: number) { return followedTeams.some(t => t.league === league && t.providerId === id); }

export function GameStatus({ game, protectedScore = false }: { game: StoredGame; protectedScore?: boolean }) {
  let label = statusLabels[game.status];
  if (!protectedScore && game.status === 'in_progress' && game.period && game.league !== 'nfl') {
    label += ` · ${game.period > 4 ? `OT${game.period - 4}` : `Q${game.period}`}`;
    if (game.clock && /^\d{1,2}:\d{2}(?:\.\d+)?$/.test(game.clock)) label += ` · ${game.clock}`;
  }
  return <span className={`game-status ${game.status}`}>{game.status === 'in_progress' && <i className="live-dot" />}{label}</span>;
}
export function TeamRow({ team, score, league, winner, visible, home }: { team: GameTeam; score: number | null; league: FreeLeague; winner: boolean; visible: boolean; home: boolean }) {
  const followed = isBayTeam(league, team.providerId);
  return <div className={`game-team${winner && visible ? ' winner' : ''}`}>
    {followed ? <TeamMark league={league} small /> : <span className="opponent-mark" aria-hidden="true">{team.abbreviation?.slice(0, 4) || '—'}</span>}
    <span className="game-team-name">{team.name || `Team ${team.providerId}`}<span className="followed-tag">{home ? 'Home' : 'Away'}{followed ? ' · Bay Area' : ''}</span></span>
    <span className="game-score">{visible ? score ?? '—' : '—'}</span>
  </div>;
}
export function Matchup({ game, hideScore }: { game: StoredGame; hideScore: boolean }) {
  const final = game.status === 'final' && game.homeScore !== null && game.awayScore !== null;
  const visible = showScores(game.status) && !hideScore;
  return <>
    <TeamRow team={game.awayTeam} score={game.awayScore} league={game.league} winner={Boolean(final && game.awayScore! > game.homeScore!)} visible={visible} home={false} />
    <TeamRow team={game.homeTeam} score={game.homeScore} league={game.league} winner={Boolean(final && game.homeScore! > game.awayScore!)} visible={visible} home />
  </>;
}
export function GameCard({ game, now, delayed, hideScore, protection, onReveal, onOpen }: {
  game: StoredGame; now: number; delayed: boolean; hideScore: boolean; protection: boolean;
  onReveal: () => void; onOpen: (game: StoredGame, trigger: HTMLButtonElement) => void;
}) {
  const played = showScores(game.status);
  return <article className={`game-card${game.status === 'in_progress' ? ' in-progress' : ''}`} aria-label={`${game.awayTeam.name} at ${game.homeTeam.name}`} data-scroll-anchor={`game-${game.league}-${game.providerId}`}>
    <div className="game-meta"><span className={`league-label ${game.league}`}>{game.league.toUpperCase()}</span><GameStatus game={game} protectedScore={hideScore} /></div>
    <Matchup game={game} hideScore={hideScore} />
    {protection && played && <button className="reveal-score" onClick={onReveal}>{hideScore ? 'Reveal score' : 'Hide score'}</button>}
    <div className="game-footer"><span>{game.startsAt ? `${formatTime(game.startsAt)} PT` : 'Time TBD'}</span><span className={delayed ? 'delayed-text' : ''}>{delayed ? 'Update delayed' : checkLabel(game.observedAt, now)}</span></div>
    <button className="game-details-button" onClick={event => onOpen(game, event.currentTarget)}>Game details <Arrow /></button>
  </article>;
}
