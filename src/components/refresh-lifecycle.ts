export const SCORE_REFRESH_MS = 15_000;
export interface RefreshEnvironment {
  visible(): boolean;
  online(): boolean;
  document: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  every(callback: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
}

export function startVisibleRefresh(refresh: () => void, environment: RefreshEnvironment, offline: () => void = () => {}) {
  const run = () => { if (environment.visible() && environment.online()) refresh(); };
  const onOffline = () => offline();
  const timer = environment.every(run, SCORE_REFRESH_MS);
  environment.document.addEventListener('visibilitychange', run);
  environment.window.addEventListener('online', run);
  environment.window.addEventListener('focus', run);
  environment.window.addEventListener('offline', onOffline);
  run();
  return () => {
    environment.cancel(timer);
    environment.document.removeEventListener('visibilitychange', run);
    environment.window.removeEventListener('online', run);
    environment.window.removeEventListener('focus', run);
    environment.window.removeEventListener('offline', onOffline);
  };
}
