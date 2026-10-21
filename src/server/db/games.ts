import 'server-only';
import type { GamesQuery } from './game-query';
import { readGames } from './game-reader';
import { getPool } from './pool';
import type { FreeLeague } from '../../shared/games';
import { pacificDate } from '../../shared/dates';
export function listGames(query: GamesQuery) { return readGames(getPool(), query); }
export async function findGame(league: FreeLeague, gameId: number) {
  const today = pacificDate();
  const response = await readGames(getPool(), { league, view: 'all', from: today, to: today }, gameId);
  return response.data[0] ?? null;
}
