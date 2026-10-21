import { freeLeagues, type FreeLeague, type StoredGame } from './games';

export const PREFERENCES_KEY = 'bayline.fan-preferences.v1';
export interface FanPreferences { leagues: FreeLeague[]; hideScores: boolean; }
export const defaultPreferences: FanPreferences = { leagues: [...freeLeagues], hideScores: false };

export function parsePreferences(value: string | null): FanPreferences {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (!parsed || typeof parsed !== 'object') return { ...defaultPreferences, leagues: [...freeLeagues] };
    const data = parsed as Record<string, unknown>;
    const leagues = Array.isArray(data.leagues)
      ? freeLeagues.filter(league => (data.leagues as unknown[]).includes(league))
      : [...freeLeagues];
    return { leagues, hideScores: data.hideScores === true };
  } catch { return { ...defaultPreferences, leagues: [...freeLeagues] }; }
}

export function gameKey(game: Pick<StoredGame, 'league' | 'providerId'>): string { return `${game.league}:${game.providerId}`; }

export function nextGameForTeam(games: StoredGame[], league: FreeLeague, now: number, today: string): StoredGame | undefined {
  return games.filter(game => game.league === league && (
    game.status === 'in_progress' ||
    (['scheduled', 'delayed', 'postponed', 'unknown'].includes(game.status) &&
      (game.startsAt ? Date.parse(game.startsAt) >= now || ['delayed', 'postponed'].includes(game.status) && game.localDate >= today : game.localDate >= today))
  )).sort((a, b) => {
    if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
    if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
    return a.localDate.localeCompare(b.localDate) || (a.startsAt ?? 'z').localeCompare(b.startsAt ?? 'z') || a.providerId - b.providerId;
  })[0];
}
