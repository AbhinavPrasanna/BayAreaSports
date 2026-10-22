'use client';
import { useEffect, useRef } from 'react';
import type { StoredGame } from '@/shared/games';
import { showScores } from '@/shared/scoreboard';
import { checkLabel, formatDay, formatTime, GameStatus, Matchup } from './game-ui';
import { useSnapshot } from './use-snapshot';
import { browserScroll, captureScroll, restoreScroll } from './scroll-preservation';
import { GameMedia } from './game-media';
import { AfterGameRecords,FinalsSeriesRecord } from './team-record';
import { AdvancedGameDetails } from './advanced-game-details';

export function GameDetails({ initial, refreshVersion, now, hideScore, protection, onReveal, onClose, trigger }: {
  initial: StoredGame; refreshVersion: number; now: number; hideScore: boolean; protection: boolean;
  onReveal: () => void; onClose: () => void; trigger: HTMLButtonElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const feed = useSnapshot<{ data: StoredGame }>(`/api/games/${initial.league}/${initial.providerId}`, refreshVersion, false);
  const game = feed.data?.data ?? initial;
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.body.style.overflow;
    const position = captureScroll(browserScroll);
    element.showModal(); document.body.style.overflow = 'hidden';
    return () => {
      element.close(); document.body.style.overflow = previous;
      restoreScroll(position, browserScroll);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);
  return <dialog ref={dialog} className="game-dialog" aria-labelledby="game-details-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }
  }}>
    <div className="dialog-header"><div><p className="eyebrow">{game.league.toUpperCase()} · GAME DETAILS</p><h2 id="game-details-title">{formatDay(game.localDate, { weekday: 'long', month: 'long', day: 'numeric' })}</h2></div><button autoFocus className="close-dialog" aria-label="Close game details" onClick={onClose}>×</button></div>
    <div className="detail-status"><GameStatus game={game} protectedScore={hideScore} /><span>{game.startsAt ? `${formatTime(game.startsAt)} Pacific time` : 'Start time to be announced'}</span></div>
    <div className="detail-matchup"><Matchup game={game} hideScore={hideScore} /></div>
    {protection && showScores(game.status) && <button className="detail-reveal" onClick={onReveal}>{hideScore ? 'Reveal this game’s score' : 'Hide this game’s score'}</button>}
    {hideScore && showScores(game.status) && <p className="detail-note">Spoiler protection is on. Scores and winner styling stay hidden until you reveal this game.</p>}
    {feed.error && <p className="notice" role="alert">Details couldn’t be refreshed. Showing the saved game; updates will retry automatically.</p>}
    <AfterGameRecords game={game} hidden={hideScore}/>
    <FinalsSeriesRecord game={game} hidden={hideScore}/>
    <AdvancedGameDetails game={game} hidden={hideScore}/>
    <GameMedia game={game} hideScore={hideScore} />
    <dl className="detail-facts"><div><dt>Matchup</dt><dd>{game.awayTeam.name} at {game.homeTeam.name}</dd></div><div><dt>Latest check</dt><dd>{checkLabel(game.observedAt, now)}</dd></div><div><dt>Updates</dt><dd>Refreshes every 15 seconds while this page is visible.</dd></div></dl>
    <p className="detail-note">Scores and statistics are snapshots from BALLDONTLIE. Coverage varies by league and game.</p>
    <button className="dialog-done" onClick={onClose}>Back to scoreboard</button>
  </dialog>;
}
