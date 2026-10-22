import type { Pool } from 'pg';
import type { FreeLeague } from '../../shared/games';
import { reviewedMediaSchema } from '../../shared/game-media';
import { matchesGame, verifiedMatch, type HighlightGame } from './highlight-match';
import { channelSchema, officialChannels, YouTubeClient, YouTubeFailure, type YouTubeVideo } from './youtube';

type Database = Pick<Pool, 'query'>;
const gameFields = `g.league,g.provider_id AS "providerId",g.home_team_id AS "homeTeamId",g.away_team_id AS "awayTeamId",
  to_char(g.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startsAt",
  to_char(g.starts_at AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD') AS "localDate",h.name AS "homeName",a.name AS "awayName"`;
const joins = 'JOIN teams h ON h.league=g.league AND h.provider_id=g.home_team_id JOIN teams a ON a.league=g.league AND a.provider_id=g.away_team_id';
const exactGame = (alias: string) => `${alias}.payload->>'homeTeamId'=g.home_team_id::text AND ${alias}.payload->>'awayTeamId'=g.away_team_id::text AND (${alias}.payload->>'startsAt')::timestamptz=g.starts_at`;

export async function storeAutomaticHighlight(db: Database, game: HighlightGame, video: YouTubeVideo, now: number) {
  const verifiedAt = new Date(now).toISOString();
  const restriction = video.contentDetails.regionRestriction;
  const embeddable = video.status.embeddable && !restriction?.blocked?.includes('US') && (!restriction?.allowed || restriction.allowed.includes('US'));
  const payload = reviewedMediaSchema.parse({ ...game, verifiedAt, sourceUrl: `https://www.youtube.com/watch?v=${video.id}`, broadcasts: [], highlight: { videoId: video.id, title: video.snippet.title, channel: officialChannels[game.league].label, verifiedAt, embeddable } });
  // Recheck the game after network I/O; a corrected/rescheduled game must not
  // acquire a video based on the previous snapshot. Manual entries remain separate.
  const result = await db.query(`INSERT INTO youtube_highlights (league,provider_id,video_id,channel_id,payload,verified_at,expires_at)
    SELECT league,provider_id,$3,$4,$5::jsonb,$6::timestamptz,$6::timestamptz+interval '28 days' FROM games
    WHERE league=$1 AND provider_id=$2 AND status='final' AND home_team_id=$7 AND away_team_id=$8 AND starts_at=$9::timestamptz
    ON CONFLICT (league,provider_id) DO UPDATE SET video_id=EXCLUDED.video_id,channel_id=EXCLUDED.channel_id,payload=EXCLUDED.payload,
      verified_at=EXCLUDED.verified_at,expires_at=EXCLUDED.expires_at RETURNING video_id`,
  [game.league,game.providerId,video.id,video.snippet.channelId,JSON.stringify(payload),verifiedAt,game.homeTeamId,game.awayTeamId,game.startsAt]);
  return result.rows.length;
}

/** Called only by the single advisory-locked worker. At most one league per turn. */
export async function syncNextHighlights(db: Database, key: string | undefined, leagues: FreeLeague[], signal: AbortSignal,
  options: { now?: number; request?: typeof fetch } = {}) {
  const now = options.now ?? Date.now(), stamp = new Date(now).toISOString();
  // Expired API metadata is removed even if fetching is disabled or the key fails.
  await db.query('DELETE FROM youtube_highlights WHERE expires_at <= $1', [stamp]);
  await db.query("UPDATE youtube_discovery_state SET channel=NULL,channel_verified_at=NULL WHERE channel_verified_at<$1::timestamptz-interval '28 days'", [stamp]);
  if (!key || signal.aborted || !leagues.length) return { status: 'disabled' as const };
  const due = await db.query<{league: FreeLeague; consecutive_failures: number; channel: unknown; channel_verified_at: Date | null}>(`SELECT league,consecutive_failures,channel,channel_verified_at FROM youtube_discovery_state
    WHERE league=ANY($1::text[]) AND next_check_at<=$2 ORDER BY next_check_at,league LIMIT 1`, [leagues,stamp]);
  if (!due.rows[0]) return { status: 'idle' as const };
  const state = due.rows[0], league = state.league;
  await db.query("UPDATE youtube_discovery_state SET next_check_at=$2::timestamptz+interval '10 minutes' WHERE league=$1", [league,stamp]);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const client = new YouTubeClient(key, async () => {
    // Each list request costs one unit. 500 per league/day is a conservative
    // persistent application cap; never use the expensive search endpoint.
    const slot = await db.query(`UPDATE youtube_discovery_state SET
      quota_day=($2::timestamptz AT TIME ZONE 'America/Los_Angeles')::date,
      requests_today=CASE WHEN quota_day=($2::timestamptz AT TIME ZONE 'America/Los_Angeles')::date THEN requests_today+1 ELSE 1 END
      WHERE league=$1 AND (quota_day IS DISTINCT FROM ($2::timestamptz AT TIME ZONE 'America/Los_Angeles')::date OR requests_today<500) RETURNING league`, [league,stamp]);
    if (!slot.rows.length) throw new YouTubeFailure('YOUTUBE_LOCAL_QUOTA', 86400_000);
  }, deadline, options.request);
  let added = 0, refreshed = 0;
  try {
    const games = (await db.query<HighlightGame>(`SELECT ${gameFields} FROM games g ${joins}
      WHERE g.league=$1 AND (h.enabled OR a.enabled) AND g.status='final'
      AND g.starts_at BETWEEN $2::timestamptz-interval '7 days' AND $2::timestamptz
      AND NOT EXISTS (SELECT 1 FROM game_media m WHERE m.league=g.league AND m.provider_id=g.provider_id AND ${exactGame('m')} AND m.payload->'highlight' IS NOT NULL AND m.payload->'highlight'<>'null'::jsonb)
      AND NOT EXISTS (SELECT 1 FROM youtube_highlights y WHERE y.league=g.league AND y.provider_id=g.provider_id AND ${exactGame('y')} AND y.expires_at>$2)
      ORDER BY g.starts_at DESC LIMIT 20`, [league,stamp])).rows;
    const refresh = (await db.query<HighlightGame & {videoId: string}>(`SELECT ${gameFields},y.video_id AS "videoId"
      FROM youtube_highlights y JOIN games g ON g.league=y.league AND g.provider_id=y.provider_id ${joins}
      WHERE y.league=$1 AND g.status='final' AND y.verified_at<$2::timestamptz-interval '7 days'
      ORDER BY y.verified_at LIMIT 20`, [league,stamp])).rows;
    if (games.length || refresh.length) {
      const cached = channelSchema.safeParse(state.channel);
      const channel = cached.success && state.channel_verified_at && now - state.channel_verified_at.getTime() < 7 * 86400_000 ? cached.data : await client.channel(league);
      if (!cached.success || !state.channel_verified_at || now - state.channel_verified_at.getTime() >= 7 * 86400_000)
        await db.query('UPDATE youtube_discovery_state SET channel=$2::jsonb,channel_verified_at=$3 WHERE league=$1', [league,JSON.stringify(channel),stamp]);
      if (refresh.length) {
        const videos = await client.videos(refresh.map(game => game.videoId));
        for (const game of refresh) {
          const video = videos.find(v => v.id === game.videoId);
          if (video && verifiedMatch(game, video, channel.id, now)) refreshed += await storeAutomaticHighlight(db, game, video, now);
          else await db.query('DELETE FROM youtube_highlights WHERE league=$1 AND provider_id=$2', [league,game.providerId]);
        }
      }
      if (games.length) {
        const uploads = await client.uploads(channel, Math.min(...games.map(game => Date.parse(game.startsAt))));
        const candidates = uploads.filter(upload => games.filter(game => matchesGame(game, upload, now)).length === 1);
        const ids = [...new Set(candidates.map(v => v.id))].slice(0, 50);
        const videos = await client.videos(ids);
        for (const game of games) {
          const matches = videos.filter(video => verifiedMatch(game, video, channel.id, now));
          // Multiple competing exact-match uploads are left for manual review.
          if (matches.length === 1) added += await storeAutomaticHighlight(db, game, matches[0], now);
        }
      }
    }
    await db.query('UPDATE youtube_discovery_state SET last_success_at=$2,last_error_code=NULL,consecutive_failures=0 WHERE league=$1', [league,stamp]);
    console.log(JSON.stringify({ event: 'highlights_checked', league, added, refreshed }));
    return { status: 'checked' as const, league, added, refreshed };
  } catch (error) {
    if (signal.aborted) return { status: 'stopped' as const };
    const code = error instanceof YouTubeFailure ? error.code : 'YOUTUBE_VALIDATION';
    const delay = error instanceof YouTubeFailure && error.retryMs ? error.retryMs : Math.min(21600_000, 600_000 * 2 ** Math.min(state.consecutive_failures, 5));
    await db.query('UPDATE youtube_discovery_state SET last_error_code=$2,consecutive_failures=consecutive_failures+1,next_check_at=$3 WHERE league=$1', [league,code,new Date(now + delay)]);
    console.error(JSON.stringify({ event: 'highlights_check_failed', league, code }));
    return { status: 'failed' as const, league, code };
  }
}
