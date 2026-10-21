'use client';
import { useEffect, useRef } from 'react';
import { freeLeagues } from '@/shared/games';
import type { FanPreferences } from '@/shared/fan-preferences';
import { TeamMark, teamInfo } from './game-ui';
import { browserScroll, captureScroll, restoreScroll } from './scroll-preservation';

export function PreferencesDialog({ value, onChange, onClose, trigger, temporary }: {
  value: FanPreferences; onChange: (value: FanPreferences) => void; onClose: () => void;
  trigger: HTMLButtonElement | null; temporary: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!; const previous = document.body.style.overflow;
    const position = captureScroll(browserScroll);
    element.showModal(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previous; restoreScroll(position, browserScroll); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [trigger]);
  return <dialog ref={dialog} className="game-dialog preferences-dialog" aria-labelledby="preferences-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-header"><div><p className="eyebrow">MAKE IT YOUR BAY</p><h2 id="preferences-title">Your teams</h2></div><button autoFocus className="close-dialog" aria-label="Close team preferences" onClick={onClose}>×</button></div>
    <p className="detail-note">Choose the teams you follow. Your lineup and spoiler setting stay saved on this device.</p>
    <fieldset className="follow-options"><legend>Follow teams</legend>{freeLeagues.map(league => <label key={league}><TeamMark league={league} /><span><strong>{teamInfo[league].short}</strong><small>{teamInfo[league].city} · {league.toUpperCase()}</small></span><input type="checkbox" aria-label={`Follow ${teamInfo[league].short}`} checked={value.leagues.includes(league)} onChange={event => onChange({ ...value, leagues: event.target.checked ? freeLeagues.filter(item => value.leagues.includes(item) || item === league) : value.leagues.filter(item => item !== league) })} /></label>)}</fieldset>
    <label className="spoiler-preference"><span><strong>Spoiler protection</strong><small>Hide scores and winner styling until you reveal a game.</small></span><input type="checkbox" aria-label="Spoiler protection" checked={value.hideScores} onChange={event => onChange({ ...value, hideScores: event.target.checked })} /></label>
    <p className="preference-save" role="status">{temporary ? 'Browser storage is unavailable. These choices apply to this visit.' : 'Saved on this device. Times are shown in Pacific time.'}</p>
    <button className="dialog-done" onClick={onClose}>Done</button>
  </dialog>;
}
