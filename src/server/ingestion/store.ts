import type { PoolClient } from 'pg';
import { followedTeams, type FreeLeague, type NormalizedGame } from '../../shared/games';

export async function storeGames(client: PoolClient, league: FreeLeague, games: NormalizedGame[], runId: string, window: { from: string; to: string }, nextSync: Date) {
  const observed = new Date();
  await client.query('BEGIN');
  try {
    for (const game of games) {
      for (const team of [game.homeTeam, game.awayTeam]) {
        const followed = followedTeams.some(value => value.league === league && value.providerId === team.providerId);
        await client.query(`INSERT INTO teams (league, provider_id, name, abbreviation, enabled)
          VALUES ($1,$2::integer,COALESCE($3,'Team ' || ($2::integer)::text),$4,$5)
          ON CONFLICT (league,provider_id) DO UPDATE SET name=COALESCE($3,teams.name), abbreviation=COALESCE($4,teams.abbreviation)`,
        [league, team.providerId, team.name, team.abbreviation, followed]);
      }
      await client.query(`INSERT INTO games (league,provider_id,home_team_id,away_team_id,home_score,away_score,starts_at,calendar_date,status,original_status,period,clock,observed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (league,provider_id) DO UPDATE SET
          home_team_id=EXCLUDED.home_team_id, away_team_id=EXCLUDED.away_team_id,
          home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score,
          starts_at=EXCLUDED.starts_at, calendar_date=EXCLUDED.calendar_date,
          status=EXCLUDED.status, original_status=EXCLUDED.original_status,
          period=EXCLUDED.period, clock=EXCLUDED.clock, observed_at=EXCLUDED.observed_at,
          changed_at=CASE WHEN ROW(games.home_team_id,games.away_team_id,games.home_score,games.away_score,games.starts_at,games.calendar_date,games.status,games.original_status,games.period,games.clock)
            IS DISTINCT FROM ROW(EXCLUDED.home_team_id,EXCLUDED.away_team_id,EXCLUDED.home_score,EXCLUDED.away_score,EXCLUDED.starts_at,EXCLUDED.calendar_date,EXCLUDED.status,EXCLUDED.original_status,EXCLUDED.period,EXCLUDED.clock)
            THEN now() ELSE games.changed_at END`,
        [league, game.providerId, game.homeTeamId, game.awayTeamId, game.homeScore, game.awayScore, game.startsAt, game.calendarDate, game.status, game.originalStatus, game.period, game.clock, observed]);
    }
    await client.query(`UPDATE ingestion_state SET last_success_at=$2, next_sync_at=$3, last_error_code=NULL, consecutive_failures=0,
      game_count=$4, window_start=$5, window_end=$6 WHERE league=$1`, [league, observed, nextSync, games.length, window.from, window.to]);
    await client.query("UPDATE sync_runs SET status='succeeded', completed_at=now() WHERE id=$1", [runId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
