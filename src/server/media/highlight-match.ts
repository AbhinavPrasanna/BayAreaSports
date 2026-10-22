import type { FreeLeague } from '../../shared/games';
import type { Upload, YouTubeVideo } from './youtube';

export interface HighlightGame {
  league: FreeLeague; providerId: number; homeTeamId: number; awayTeamId: number;
  startsAt: string; localDate: string; homeName: string; awayName: string;
}
const words = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function teamMatches(part: string, name: string) {
  const full = words(name);
  const nickname = full.split(' ').at(-1)!;
  return [full, nickname, ...(full.startsWith('los angeles ') ? ['la ' + nickname] : [])].includes(words(part));
}
export function matchesGame(game: HighlightGame, upload: Upload, now: number): boolean {
  const published = Date.parse(upload.publishedAt), start = Date.parse(game.startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(published) || published < start + 90 * 60000 || published > start + 72 * 3600000 || published > now + 300000) return false;
  const title = upload.title;
  if (!/\b(?:full\s+)?game highlights\b/i.test(title) || /\b(preseason|summer league|simulation|madden|2k\d*|preview|prediction|reaction|throwback|classic)\b/i.test(title)) return false;
  const matchup = title.split('|')[0].replace(/\b(?:full\s+)?game highlights\b/i, '').trim().replace(/[\s:–—-]+$/, '');
  const pair = matchup.split(/\s+(?:vs\.?|at|@)\s+/i);
  if (pair.length !== 2 || !((teamMatches(pair[0], game.homeName) && teamMatches(pair[1], game.awayName)) || (teamMatches(pair[1], game.homeName) && teamMatches(pair[0], game.awayName)))) return false;
  const [year, month, day] = game.localDate.split('-').map(Number);
  if (game.league === 'nfl') {
    // NFL full-game titles identify the season/week; the publication window
    // distinguishes this matchup from another season's or return fixture.
    const season = month <= 2 ? year - 1 : year;
    return new RegExp(`\\b(?:${season} NFL Season|NFL ${season} Season)\\s+(?:Week\\s+\\d{1,2}|Wild\\s*Card|Divisional|Conference Championship|Super Bowl)\\b`, 'i').test(title);
  }
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const longMonth = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date);
  const shortMonth = longMonth.slice(0, 3);
  return new RegExp(`\\b(?:${longMonth}|${shortMonth}\\.?)\\s+0?${day},?\\s+${year}\\b`, 'i').test(title)
    || new RegExp(`\\b0?${month}/0?${day}/${year}\\b`).test(title);
}
export function verifiedMatch(game: HighlightGame, video: YouTubeVideo, channelId: string, now: number): boolean {
  const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(video.contentDetails.duration);
  const seconds = duration ? Number(duration[1] ?? 0) * 3600 + Number(duration[2] ?? 0) * 60 + Number(duration[3] ?? 0) : 0;
  return video.snippet.channelId === channelId && video.status.privacyStatus === 'public' && video.status.uploadStatus === 'processed'
    && (!video.snippet.liveBroadcastContent || video.snippet.liveBroadcastContent === 'none') && seconds >= 90 && seconds <= 2700
    && matchesGame(game, { id: video.id, title: video.snippet.title, publishedAt: video.snippet.publishedAt }, now);
}
