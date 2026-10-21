import { z } from 'zod';
import { followedTeams, gameStatuses, type FreeLeague, type NormalizedGame, type GameTeam } from '../../../shared/games';
import { isCalendarDate } from '../../../shared/dates';

const score = z.number().int().nonnegative().nullable().optional();
const team = z.object({ id: z.number().int().positive(), full_name: z.string().nullable().optional(), name: z.string().nullable().optional(), city: z.string().nullable().optional(), abbreviation: z.string().nullable().optional() });
const gameSchema = z.object({
  id: z.number().int().positive(), home_team: team, visitor_team: team,
  home_team_score: score, visitor_team_score: score, home_score: score, away_score: score,
  date: z.string().nullable().optional(), datetime: z.string().nullable().optional(),
  status: z.string().nullable().optional(), status_state: z.string().nullable().optional(),
  period: z.number().int().nullable().optional(), time: z.string().nullable().optional(),
});

export function normalizeGame(league: FreeLeague, input: unknown): NormalizedGame {
  const parsed = gameSchema.safeParse(input);
  if (!parsed.success) throw new Error('Provider game response failed validation. Raw payload omitted.');
  const game = parsed.data;
  const status = gameStatuses.find(value => value === game.status_state) ?? 'unknown';
  const start = league === 'nba' ? game.datetime : game.date;
  const startsAt = start && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start) && Number.isFinite(Date.parse(start)) ? new Date(start).toISOString() : null;
  const calendarDate = game.date?.slice(0, 10);
  const normalizeTeam = (value: z.infer<typeof team>): GameTeam => ({
    providerId: value.id,
    name: followedTeams.find(t => t.league === league && t.providerId === value.id)?.name
      ?? (value.full_name?.trim() || [value.city?.trim(), value.name?.trim()].filter(Boolean).join(' ') || null),
    abbreviation: value.abbreviation?.trim() || null,
  });
  return {
    provider: 'balldontlie', league, providerId: game.id,
    homeTeamId: game.home_team.id, awayTeamId: game.visitor_team.id,
    homeScore: league === 'wnba' ? game.home_score ?? null : game.home_team_score ?? null,
    awayScore: league === 'wnba' ? game.away_score ?? null : game.visitor_team_score ?? null,
    startsAt, calendarDate: calendarDate && isCalendarDate(calendarDate) ? calendarDate : null,
    status, originalStatus: game.status ?? null,
    period: league === 'nfl' ? null : game.period ?? null,
    clock: league === 'nfl' ? null : game.time ?? null,
    homeTeam: normalizeTeam(game.home_team), awayTeam: normalizeTeam(game.visitor_team),
  };
}
