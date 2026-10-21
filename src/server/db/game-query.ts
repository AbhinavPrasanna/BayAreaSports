import { z } from 'zod';
import { addDays, isCalendarDate, pacificDate } from '../../shared/dates';

const day = z.string().refine(isCalendarDate);
export const gamesQuerySchema = z.object({
  league: z.enum(['all', 'nba', 'nfl', 'wnba']).default('all'),
  view: z.enum(['all', 'upcoming', 'results', 'live']).default('all'),
  from: day,
  to: day,
}).refine(value => value.from <= value.to && value.to <= addDays(value.from, 30));
export type GamesQuery = z.infer<typeof gamesQuerySchema>;
export function parseGamesQuery(params: URLSearchParams, now = new Date()) {
  const today = pacificDate(now);
  return gamesQuerySchema.safeParse({
    league: params.get('league') ?? 'all', view: params.get('view') ?? 'all',
    from: params.get('from') ?? today, to: params.get('to') ?? addDays(today, 6),
  });
}
