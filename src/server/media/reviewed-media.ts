import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { parseMediaCatalog, type ReviewedMedia } from '../../shared/game-media';

export function loadReviewedMedia(filename = 'data/reviewed-game-media.json') {
  return parseMediaCatalog(JSON.parse(readFileSync(filename, 'utf8')));
}

export async function importReviewedMedia(pool: Pick<Pool, 'query'>, entries: ReviewedMedia[]) {
  let matched = 0;
  for (const entry of entries) {
    const result = await pool.query(`INSERT INTO game_media (league,provider_id,payload)
      SELECT league,provider_id,$3::jsonb FROM games
      WHERE league=$1 AND provider_id=$2 AND home_team_id=$4 AND away_team_id=$5 AND starts_at=$6::timestamptz
      ON CONFLICT (league,provider_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()
      WHERE game_media.payload IS DISTINCT FROM EXCLUDED.payload RETURNING provider_id`,
    [entry.league, entry.providerId, JSON.stringify(entry), entry.homeTeamId, entry.awayTeamId, entry.startsAt]);
    matched += result.rows.length;
  }
  return { changed: matched, reviewed: entries.length };
}
