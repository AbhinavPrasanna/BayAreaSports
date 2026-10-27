'use client';
import { useState } from 'react';
import type { StoredGame } from '@/shared/games';
import { YouTubePlayer } from './youtube-player';

function Highlights({ game, hideScore }: { game: StoredGame; hideScore: boolean }) {
  const [revealed, setRevealed] = useState(false);
  if (hideScore && !revealed) return <div className="media-protected">
    <p>Highlights can reveal the result. Video titles and the player stay hidden until you choose to watch.</p>
    <button className="media-reveal" onClick={() => setRevealed(true)}>Reveal highlights</button>
    <small>Your score stays hidden.</small>
  </div>;
  const media = game.media;
  return media?.highlight ? <YouTubePlayer key={media.highlight.videoId} highlight={media.highlight} /> : <>
    <p className="media-note">Highlights not available yet. A verified video for this matchup hasn’t been added.</p>
    {media && <a className="media-external" href={media.youtubeSearchUrl} target="_blank" rel="noopener">Search the official YouTube channel <span aria-hidden="true">↗</span></a>}
  </>;
}

export function GameMedia({ game, hideScore }: { game: StoredGame; hideScore: boolean }) {
  const media = game.media;
  if (!media || !['scheduled','in_progress','delayed','postponed','unknown','final'].includes(game.status)) return null;
  const finished = game.status === 'final';
  return <section className="game-media" aria-label={finished ? 'Game highlights' : 'Where to watch'}>
    <div className="media-heading"><span aria-hidden="true">{finished ? '▶' : '◉'}</span><h3>{finished ? 'Game highlights' : 'Where to watch'}</h3>{!finished && <span>U.S. viewing</span>}</div>
    {finished ? <Highlights key={`${game.league}:${game.providerId}:${hideScore}`} game={game} hideScore={hideScore} /> : <>
      {media.broadcasts.length ? <>
        <div className="broadcast-list">{media.broadcasts.map(item => <a key={`${item.label}:${item.url}`} href={item.url} target="_blank" rel="noopener" className="broadcast-link"><span><strong>{item.label}</strong><small>{item.kind === 'stream' ? 'Streaming' : 'TV / provider access'} · {item.access}</small></span><span aria-hidden="true">↗</span></a>)}</div>
        <p className="media-caption">{media.broadcastSource==='official_schedule'?'Checked':'Reviewed'} {media.verifiedAt ? new Date(media.verifiedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short' }) : ''}{media.sourceUrl && <> · <a href={media.sourceUrl} target="_blank" rel="noopener">Official listing ↗</a></>}</p>
      </> : <p className="media-note">{['delayed','postponed'].includes(game.status) ? 'The schedule changed. Recheck the official listing for viewing details.' : 'Game-specific viewing options haven’t been confirmed here yet.'}</p>}
      {media.broadcastDelayed && <p className="media-note">Viewing updates are delayed. {media.broadcasts.length?'These are the last confirmed listings. ':''}Check the official schedule before watching.</p>}
      <a className="media-external" href={media.guide.url} target="_blank" rel="noopener">{media.guide.label} <span aria-hidden="true">↗</span></a>
      <p className="media-caption">Availability depends on location and your subscription or TV provider. Links open the official service; sign-in may be required.</p>
    </>}
  </section>;
}
