import type { NormalizedGame } from '../../shared/games';
import type { SportsProvider } from '../providers/types';
import { IngestionError, MAX_PAGES } from './policy';

export async function fetchTeamGames(provider: SportsProvider, teamId: number, dates: string[], beforeRequest: () => Promise<void>, signal?: AbortSignal): Promise<NormalizedGame[]> {
  const seen = new Set<number>();
  const games = new Map<number, NormalizedGame>();
  let cursor: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    signal?.throwIfAborted();
    await beforeRequest();
    signal?.throwIfAborted();
    const result = await provider.getGames({ teamId, dates, cursor }, signal);
    for (const game of result.games) {
      if (game.league !== provider.league || (game.homeTeamId !== teamId && game.awayTeamId !== teamId)) throw new IngestionError('TEAM_FILTER_MISMATCH');
      if (!game.startsAt && !game.calendarDate) throw new IngestionError('INVALID_GAME_DATE');
      games.set(game.providerId, game);
    }
    if (result.nextCursor === null) return [...games.values()];
    if (seen.has(result.nextCursor)) throw new IngestionError('CURSOR_LOOP');
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new IngestionError('PAGINATION_LIMIT');
}
