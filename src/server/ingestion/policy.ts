import { ProviderRequestError } from '../providers/balldontlie/adapter';

export const REQUEST_SPACING_MS = 14_000;
export const MAX_PAGES = 10;
export class IngestionError extends Error {
  constructor(readonly code: 'PAGINATION_LIMIT' | 'CURSOR_LOOP' | 'TEAM_FILTER_MISMATCH' | 'INVALID_GAME_DATE') { super(code); }
}
export function failurePolicy(error: unknown, failures: number, baseSeconds: number) {
  if (error instanceof ProviderRequestError) {
    if (error.status === 429) return { code: 'RATE_LIMITED', delayMs: Math.max(60_000, error.retryAfterMs) };
    if ([401, 403].includes(error.status)) return { code: `HTTP_${error.status}`, delayMs: 15 * 60_000 };
    return { code: `HTTP_${error.status}`, delayMs: Math.min(30 * 60_000, baseSeconds * 1000 * 2 ** Math.min(failures, 5)) };
  }
  return { code: error instanceof IngestionError ? error.code : 'SYNC_FAILED', delayMs: Math.min(30 * 60_000, baseSeconds * 1000 * 2 ** Math.min(failures, 5)) };
}
