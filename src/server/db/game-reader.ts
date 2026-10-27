import type { Pool } from 'pg';
import type { GamesResponse, LeagueSync, StoredGame } from '../../shared/games';
import { TIME_ZONE } from '../../shared/dates';
import type { GamesQuery } from './game-query';
import { resolveGameMedia } from '../../shared/game-media';
import { readRecordBook } from './records';
import { currentTeamRecords, recordsAtGame } from '../../shared/records';
import { readPlayerStats } from './player-stats';
import { readTeamPlayerStatus } from './player-status';

export async function readGames(pool: Pick<Pool, 'query'>, query: GamesQuery, gameId: number | null = null): Promise<GamesResponse> {
  const result = await pool.query<{ game: StoredGame & { automaticMedia?: unknown; officialBroadcasts?:unknown; broadcastExpiresAt:string|null; broadcastSourceFailed:boolean } }>(`SELECT json_build_object(
    'provider','balldontlie', 'league',g.league, 'providerId',g.provider_id,
    'homeTeamId',g.home_team_id, 'awayTeamId',g.away_team_id,
    'homeScore',g.home_score, 'awayScore',g.away_score,
    'startsAt',g.starts_at, 'calendarDate',to_char(g.calendar_date,'YYYY-MM-DD'),
    'localDate',to_char(COALESCE((g.starts_at AT TIME ZONE 'America/Los_Angeles')::date,g.calendar_date),'YYYY-MM-DD'),
    'status',g.status, 'originalStatus',g.original_status, 'period',g.period, 'clock',g.clock,
    'season',g.season,'recordPhase',g.record_phase,'lineScore',g.line_score,
    'observedAt',g.observed_at, 'changedAt',g.changed_at, 'media',m.payload,'automaticMedia',y.payload,
    'officialBroadcasts',b.payload,'broadcastExpiresAt',b.expires_at,'broadcastSourceFailed',bs.last_error_code IS NOT NULL,
    'homeTeam',json_build_object('providerId',h.provider_id,'name',h.name,'abbreviation',h.abbreviation),
    'awayTeam',json_build_object('providerId',a.provider_id,'name',a.name,'abbreviation',a.abbreviation)
    ) AS game
    FROM games g JOIN teams h ON h.league=g.league AND h.provider_id=g.home_team_id
      JOIN teams a ON a.league=g.league AND a.provider_id=g.away_team_id
      LEFT JOIN game_media m ON m.league=g.league AND m.provider_id=g.provider_id
      LEFT JOIN youtube_highlights y ON y.league=g.league AND y.provider_id=g.provider_id AND y.expires_at>now()
      LEFT JOIN official_broadcasts b ON b.league=g.league AND b.provider_id=g.provider_id
      LEFT JOIN broadcast_sync_state bs ON bs.source='nba-warriors' AND g.league='nba'
    WHERE ($1='all' OR g.league=$1)
      AND (h.enabled OR a.enabled)
      AND ($5::bigint IS NULL OR g.provider_id=$5::bigint)
      AND ($5::bigint IS NOT NULL OR COALESCE((g.starts_at AT TIME ZONE 'America/Los_Angeles')::date,g.calendar_date) BETWEEN $2::date AND $3::date)
      AND ($4='all' OR ($4='results' AND g.status='final') OR ($4='live' AND g.status='in_progress')
        OR ($4='upcoming' AND g.status IN ('scheduled','delayed','postponed','unknown')))
    ORDER BY COALESCE((g.starts_at AT TIME ZONE 'America/Los_Angeles')::date,g.calendar_date),g.starts_at NULLS LAST,g.league,g.provider_id LIMIT 500`,
  [query.league, query.from, query.to, query.view, gameId]);
  const states = await pool.query<{ state: LeagueSync }>(`SELECT json_build_object('league',league,'lastAttemptAt',last_attempt_at,
    'lastSuccessAt',last_success_at,'nextSyncAt',next_sync_at,'lastErrorCode',last_error_code,'gameCount',game_count) AS state
    FROM ingestion_state ORDER BY league`);
  const heartbeat = await pool.query<{ lastSeen: Date }>("SELECT last_seen_at AS \"lastSeen\" FROM worker_heartbeats WHERE worker_name='scheduler'");
  const recordBook=await readRecordBook(pool);
  const playerStats=gameId!==null&&result.rows.length?await readPlayerStats(pool,result.rows[0].game.league,gameId):undefined;
  const detailGame=gameId!==null?result.rows[0]?.game:undefined;
  const playerStatus=detailGame?await readTeamPlayerStatus(pool,detailGame.league,[detailGame.homeTeamId,detailGame.awayTeamId]):undefined;
  return { teamRecords:currentTeamRecords(recordBook),data: result.rows.map(({ game: { automaticMedia,officialBroadcasts,broadcastExpiresAt,broadcastSourceFailed, ...game } }) => {
    const media = resolveGameMedia(game,game.media,automaticMedia,officialBroadcasts,broadcastExpiresAt,broadcastSourceFailed);
    return { ...game, media, records:recordsAtGame(game,recordBook),...(playerStats?{playerStats}:{}),...(playerStatus?{playerStatus}:{}) };
  }), sync: { leagues: states.rows.map(row => row.state), workerLastSeenAt: heartbeat.rows[0]?.lastSeen.toISOString() ?? null, serverTime: new Date().toISOString() }, range: { from: query.from, to: query.to, timeZone: TIME_ZONE } };
}
