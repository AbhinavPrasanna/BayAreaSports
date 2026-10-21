'use client';
import { useEffect, useRef, useState } from 'react';
import type { Highlight } from '@/shared/game-media';

type Player = { destroy(): void };
type YouTube = { Player: new (element: HTMLElement, options: { events: { onReady: () => void; onError: () => void } }) => Player };
type YouTubeWindow = Window & { YT?: YouTube; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YouTube> | undefined;
function playerAPI() {
  const windowYT = window as YouTubeWindow;
  if (windowYT.YT?.Player) return Promise.resolve(windowYT.YT);
  if (!apiPromise) apiPromise = new Promise<YouTube>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Player unavailable')), 12000);
    const previous = windowYT.onYouTubeIframeAPIReady;
    windowYT.onYouTubeIframeAPIReady = () => {
      previous?.(); window.clearTimeout(timer);
      if (windowYT.YT?.Player) resolve(windowYT.YT); else reject(new Error('Player unavailable'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => { window.clearTimeout(timer); reject(new Error('Player unavailable')); };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function YouTubePlayer({ highlight }: { highlight: Highlight }) {
  const slot = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!playing) return;
    let disposed = false; let player: Player | undefined;
    const root = slot.current!;
    void playerAPI().then(api => {
      if (disposed) return;
      // YouTube owns only this child; React owns the surrounding slot.
      const frame = document.createElement('iframe');
      const params = new URLSearchParams({ enablejsapi: '1', origin: window.location.origin, playsinline: '1', autoplay: '0', rel: '0' });
      frame.src = `https://www.youtube-nocookie.com/embed/${highlight.videoId}?${params}`;
      frame.title = 'Official game highlights';
      frame.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      root.appendChild(frame);
      player = new api.Player(frame, { events: {
        onReady: () => { if (!disposed) setStatus('ready'); },
        onError: () => { if (!disposed) setStatus('error'); },
      } });
    }).catch(() => { if (!disposed) setStatus('error'); });
    return () => { disposed = true; player?.destroy(); root.replaceChildren(); };
  }, [playing, highlight.videoId]);
  return <>
    <p className="highlight-title">{highlight.title}</p>
    <p className="media-caption">Official highlights · {highlight.channel}</p>
    {!playing ? <button className="highlight-play" onClick={() => setPlaying(true)}><span aria-hidden="true">▶</span> Play highlights</button> : <>
      <div className="youtube-player" ref={slot} hidden={status === 'error'} />
      {status === 'loading' && <p className="media-caption" role="status">Loading YouTube player…</p>}
      {status === 'error' && <p className="media-note" role="status">This video couldn’t play here. It may be restricted or unavailable. Try opening it on YouTube.</p>}
      <button className="media-text-button" onClick={() => { setPlaying(false); setStatus('loading'); }}>Close player</button>
    </>}
    <a className="media-external" href={`https://www.youtube.com/watch?v=${highlight.videoId}`} target="_blank" rel="noopener">Open on YouTube <span aria-hidden="true">↗</span></a>
  </>;
}
