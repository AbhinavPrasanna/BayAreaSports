import { followedTeams, type FreeLeague, type NormalizedGame } from './games';
import { pacificDate } from './dates';

export type RecordPhase = 'regular' | 'playoffs';
export interface RecordTally { wins: number; losses: number; ties: number; }
export interface RecordDataset { league: FreeLeague; season: number; phase: RecordPhase; ready: boolean; checkedAt: string | null; delayed: boolean; games: NormalizedGame[]; }
export interface CurrentTeamRecord { league: FreeLeague; season: number; regular: RecordTally | null; playoffs: RecordTally | null; delayed: boolean; checkedAt: string | null; }
export interface GameRecords { season: number; phase: RecordPhase; homeBefore: RecordTally | null; awayBefore: RecordTally | null; homeAfter: RecordTally | null; awayAfter: RecordTally | null; checkedAt: string; delayed: boolean; }
export function seasonForLeague(league: FreeLeague, date = new Date()): number {
  const [year, month] = pacificDate(date).split('-').map(Number);
  return year - ((league === 'nba' && month < 7) || (league === 'nfl' && month < 3) ? 1 : 0);
}
export function seasonLabel(league: FreeLeague, season: number) { return league === 'nba' ? `${season}–${String(season + 1).slice(-2)}` : String(season); }
export function recordLabel(record: RecordTally, league: FreeLeague) { return `${record.wins}–${record.losses}${league === 'nfl' ? `–${record.ties}` : ''}`; }
function gameTime(game: NormalizedGame) { return Date.parse(game.startsAt ?? `${game.calendarDate}T12:00:00Z`); }

export function tallyRecord(dataset: RecordDataset | undefined, teamId: number, cutoff: number, includeBoundary = true): RecordTally | null {
  if (!dataset?.ready) return null;
  const result = { wins: 0, losses: 0, ties: 0 };
  for (const game of dataset.games) {
    if (game.homeTeamId !== teamId && game.awayTeamId !== teamId) continue;
    const time = gameTime(game);
    if (!Number.isFinite(time)) return null;
    if (time > cutoff || (!includeBoundary && time === cutoff) || game.status !== 'final') continue;
    if (game.homeScore === null || game.awayScore === null || (game.homeScore === game.awayScore && game.league !== 'nfl')) return null;
    if (game.homeScore === game.awayScore) result.ties++;
    else if ((game.homeTeamId === teamId && game.homeScore > game.awayScore) || (game.awayTeamId === teamId && game.awayScore > game.homeScore)) result.wins++;
    else result.losses++;
  }
  return result;
}
export function recordsAtGame(game: NormalizedGame, datasets: RecordDataset[], now = Date.now()): GameRecords | null {
  // Prefer membership in the provider's phase-filtered snapshot over inference.
  const dataset = datasets.find(d => d.league === game.league && d.ready && d.games.some(g => g.providerId === game.providerId))
    ?? datasets.find(d => d.league === game.league && d.season === game.season && d.phase === game.recordPhase);
  if (!dataset?.ready || !dataset.checkedAt || !game.startsAt) return null;
  const start = Date.parse(game.startsAt);
  const before = Math.min(start, now);
  return { season: dataset.season, phase: dataset.phase, checkedAt: dataset.checkedAt, delayed: dataset.delayed,
    homeBefore: tallyRecord(dataset, game.homeTeamId, before, start > now), awayBefore: tallyRecord(dataset, game.awayTeamId, before, start > now),
    homeAfter: game.status === 'final' ? tallyRecord(dataset, game.homeTeamId, start) : null,
    awayAfter: game.status === 'final' ? tallyRecord(dataset, game.awayTeamId, start) : null };
}
export function currentTeamRecords(datasets: RecordDataset[], now = Date.now()): CurrentTeamRecord[] {
  return followedTeams.map(team => {
    const season = seasonForLeague(team.league as FreeLeague, new Date(now));
    const phases = datasets.filter(d => d.league === team.league && d.season === season);
    const checkedAt = phases.map(d => d.checkedAt).filter((v): v is string => !!v).sort()[0] ?? null;
    return { league: team.league as FreeLeague, season,
      regular: tallyRecord(phases.find(d => d.phase === 'regular'), team.providerId, now),
      playoffs: tallyRecord(phases.find(d => d.phase === 'playoffs'), team.providerId, now),
      checkedAt, delayed: phases.some(d => d.delayed) };
  });
}
