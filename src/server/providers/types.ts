import type { FreeLeague, NormalizedGame } from '../../shared/games';

export interface GameQuery { teamId: number; dates: string[]; cursor?: number; }
export interface GamePage { games: NormalizedGame[]; nextCursor: number | null; }
export interface SportsProvider {
  readonly league: FreeLeague;
  getGames(query: GameQuery, signal?: AbortSignal): Promise<GamePage>;
}
