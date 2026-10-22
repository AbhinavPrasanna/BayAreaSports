export const freeLeagues = ['nba', 'nfl', 'wnba'] as const;
export type FreeLeague = (typeof freeLeagues)[number];
export type League = FreeLeague | 'nhl' | 'mls';
export const gameStatuses = ['scheduled', 'in_progress', 'final', 'postponed', 'canceled', 'delayed', 'suspended', 'abandoned', 'unknown'] as const;
export type GameStatus = (typeof gameStatuses)[number];

export interface TeamReference {
  provider: 'balldontlie';
  league: League;
  providerId: number;
  name: string;
}

export interface NormalizedGame {
  provider: 'balldontlie';
  league: FreeLeague;
  providerId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  startsAt: string | null;
  calendarDate: string | null;
  status: GameStatus;
  originalStatus: string | null;
  period: number | null;
  clock: string | null;
  homeTeam: GameTeam;
  awayTeam: GameTeam;
  season?: number | null;
  recordPhase?: 'regular' | 'playoffs' | null;
  lineScore?: import('./advanced-game').GameLineScore | null;
}

export interface GameTeam { providerId: number; name: string | null; abbreviation: string | null; }
export interface StoredGame extends NormalizedGame { localDate: string; observedAt: string; changedAt: string; media?: import('./game-media').GameMedia; records?: import('./records').GameRecords | null; playerStats?: import('./advanced-game').PlayerStatsSnapshot; }
export interface LeagueSync {
  league: FreeLeague;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextSyncAt: string;
  lastErrorCode: string | null;
  gameCount: number;
}
export interface GamesResponse {
  data: StoredGame[];
  teamRecords?: import('./records').CurrentTeamRecord[];
  sync: { leagues: LeagueSync[]; workerLastSeenAt: string | null; serverTime: string; };
  range: { from: string; to: string; timeZone: 'America/Los_Angeles'; };
}

export const followedTeams: readonly TeamReference[] = [
  { provider: 'balldontlie', league: 'nba', providerId: 10, name: 'Golden State Warriors' },
  { provider: 'balldontlie', league: 'nfl', providerId: 30, name: 'San Francisco 49ers' },
  { provider: 'balldontlie', league: 'wnba', providerId: 13, name: 'Golden State Valkyries' },
];
