'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { startVisibleRefresh } from './refresh-lifecycle';
import { browserScroll, captureScroll, restoreScroll, type ScrollSnapshot } from './scroll-preservation';

export function useSnapshot<T>(url: string | null, refreshVersion: number, preserveScroll = true) {
  const [snapshot, setSnapshot] = useState<{ url: string; data: T; sequence: number; checkedAt: number } | null>(null);
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef(snapshot); current.current = snapshot;
  const scroll = useRef<ScrollSnapshot | null>(null);
  useLayoutEffect(() => {
    if (scroll.current) { restoreScroll(scroll.current, browserScroll); scroll.current = null; }
  }, [snapshot]);
  useEffect(() => {
    if (!url) return;
    let closed = false;
    let request: AbortController | null = null;
    async function load() {
      request?.abort();
      const controller = new AbortController(); request = controller;
      setRefreshing(true);
      try {
        const response = await fetch(url!, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        if (!response.ok) throw new Error('Snapshot unavailable');
        const data = await response.json() as T;
        if (closed || controller.signal.aborted) return;
        if (preserveScroll && current.current?.url === url && !document.querySelector('dialog[open]')) scroll.current = captureScroll(browserScroll);
        setSnapshot({ url: url!, data, sequence: (current.current?.url === url ? current.current.sequence : 0) + 1, checkedAt: Date.now() });
        setErrorUrl(null);
      } catch { if (!closed && !controller.signal.aborted) setErrorUrl(url); }
      finally { if (!closed && request === controller) setRefreshing(false); }
    }
    const stop = startVisibleRefresh(() => void load(), {
      visible: () => !document.hidden,
      online: () => navigator.onLine,
      document, window,
      every: (callback, ms) => window.setInterval(callback, ms),
      cancel: timer => window.clearInterval(timer as number),
    }, () => { request?.abort(); setRefreshing(false); setErrorUrl(url); });
    if (!navigator.onLine) setErrorUrl(url);
    return () => { closed = true; request?.abort(); stop(); };
  }, [url, refreshVersion, preserveScroll]);
  return {
    data: snapshot?.url === url ? snapshot.data : null,
    sequence: snapshot?.url === url ? snapshot.sequence : 0,
    checkedAt: snapshot?.url === url ? snapshot.checkedAt : null,
    error: url !== null && errorUrl === url,
    refreshing,
  };
}
