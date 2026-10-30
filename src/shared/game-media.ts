import { z } from 'zod';
import { freeLeagues, type StoredGame } from './games';
import { ticketSchema,ticketForGame,type GameTicket } from './tickets';

const approvedHosts = new Set(['www.nba.com','nba.com','cdn.nba.com','www.wnba.com','valkyries.wnba.com','cdn.wnba.com','www.49ers.com','www.nfl.com','www.espn.com','www.peacocktv.com','peacocktv.app.link','www.usanetwork.com','www.nbcsports.com','www.primevideo.com','www.paramountplus.com','www.fox.com','www.youtube.com']);
const link = z.string().url().refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && approvedHosts.has(url.hostname);
  } catch { return false; }
}, 'Use an approved official HTTPS source or viewing service.');
export const broadcastSchema = z.object({ label: z.string().trim().min(1).max(80), url: link, kind: z.enum(['tv','stream']), region: z.literal('US'), access: z.string().trim().min(1).max(200) });
export const highlightSchema = z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), title: z.string().trim().min(1).max(200), channel: z.enum(['NBA','NFL','WNBA','Golden State Warriors','San Francisco 49ers','Golden State Valkyries']), verifiedAt: z.string().datetime(), embeddable: z.boolean().optional() });
export const reviewedMediaSchema = z.object({
  league: z.enum(freeLeagues), providerId: z.number().int().positive(), homeTeamId: z.number().int().positive(), awayTeamId: z.number().int().positive(),
  startsAt: z.string().datetime(), verifiedAt: z.string().datetime(), sourceUrl: link,
  broadcasts: z.array(broadcastSchema).max(8).default([]), highlight: highlightSchema.nullable().default(null),
  ticket:ticketSchema.nullable().optional(),
});
export type ReviewedMedia = z.infer<typeof reviewedMediaSchema>;
export type Broadcast = z.infer<typeof broadcastSchema>;
export type Highlight = z.infer<typeof highlightSchema>;
export interface GameMedia { broadcasts: Broadcast[]; highlight: Highlight | null; sourceUrl: string | null; verifiedAt: string | null; guide: { label: string; url: string }; youtubeSearchUrl: string; broadcastSource?: 'official_schedule' | 'reviewed'; broadcastDelayed?: boolean; ticket?:GameTicket|null; }

export function parseMediaCatalog(value: unknown): ReviewedMedia[] {
  const entries = z.array(reviewedMediaSchema).max(2000).parse(value);
  const keys = entries.map(entry => `${entry.league}:${entry.providerId}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate reviewed game media entry.');
  const ticketIds=entries.flatMap(entry=>entry.ticket?[entry.ticket.eventId]:[]);
  if(new Set(ticketIds).size!==ticketIds.length)throw new Error('Duplicate Ticketmaster event assignment.');
  if(entries.some(entry=>entry.ticket&&Date.parse(entry.ticket.startsAt)!==Date.parse(entry.startsAt)))throw new Error('Ticketmaster event time must match the reviewed game.');
  return entries;
}

/** Broadcast provenance is independent of highlight provenance and never freshened by a video refresh. */
export function resolveGameMedia(game: StoredGame, manualRaw: unknown, youtubeRaw: unknown, officialRaw: unknown, expiresAt: string | null, sourceFailed: boolean, now=Date.now()): GameMedia {
  const manual=gameMedia(game,manualRaw,now), youtube=gameMedia(game,youtubeRaw,now);
  let result:GameMedia={...manual,highlight:manual.highlight??youtube.highlight,broadcastSource:'reviewed',broadcastDelayed:sourceFailed&&game.league==='nba'};
  const parsed=reviewedMediaSchema.safeParse(officialRaw);
  if(!parsed.success) return result;
  const entry=parsed.data;
  if(entry.league!==game.league || entry.providerId!==game.providerId || entry.homeTeamId!==game.homeTeamId || entry.awayTeamId!==game.awayTeamId || Date.parse(entry.startsAt)!==Date.parse(game.startsAt??'')) return result;
  const checked=Date.parse(entry.verifiedAt);
  if(checked>now+300_000) return result;
  // A newer explicit manual broadcast correction can temporarily override the feed.
  if(manual.broadcasts.length && Date.parse(manual.verifiedAt??'')>checked) return result;
  const fresh=expiresAt!==null && Date.parse(expiresAt)>now && now-checked<=86400_000;
  const official=gameMedia(game,entry,now);
  result={...result,broadcasts:fresh?official.broadcasts:[],sourceUrl:entry.sourceUrl,verifiedAt:entry.verifiedAt,broadcastSource:'official_schedule',broadcastDelayed:sourceFailed||!fresh||now-checked>30*60_000};
  return result;
}

export function gameMedia(game: StoredGame, raw: unknown, now = Date.now()): GameMedia {
  const guides = {
    nba: { label: 'Warriors official schedule', url: 'https://www.nba.com/warriors/schedule', channel: '@warriors' },
    nfl: { label: '49ers official viewing guide', url: 'https://www.49ers.com/watch-live-games/ways-to-watch', channel: '@NFL' },
    wnba: { label: 'Valkyries official schedule', url: 'https://valkyries.wnba.com/schedule', channel: '@WNBA' },
  };
  const guide = guides[game.league];
  const query = `${game.awayTeam.name ?? ''} ${game.homeTeam.name ?? ''} ${game.localDate} highlights`;
  const empty: GameMedia = { broadcasts: [], highlight: null, ticket:null, sourceUrl: null, verifiedAt: null, guide: { label: guide.label, url: guide.url }, youtubeSearchUrl: `https://www.youtube.com/${guide.channel}/search?query=${encodeURIComponent(query)}` };
  const parsed = reviewedMediaSchema.safeParse(raw);
  if (!parsed.success) return empty;
  const media = parsed.data;
  // A provider ID alone is insufficient: reject a changed opponent or rescheduled game.
  if (media.league !== game.league || media.providerId !== game.providerId || media.homeTeamId !== game.homeTeamId || media.awayTeamId !== game.awayTeamId || Date.parse(media.startsAt) !== Date.parse(game.startsAt ?? '')) return empty;
  const age = now - Date.parse(media.verifiedAt);
  const current = age >= -300_000 && age <= 7 * 86400_000;
  const playable = game.status === 'final' && media.highlight && Date.parse(media.highlight.verifiedAt) <= now + 300_000;
  return { ...empty, broadcasts: current && ['scheduled','in_progress'].includes(game.status) ? media.broadcasts : [], highlight: playable ? media.highlight : null, ticket:ticketForGame(game,now,media.ticket), sourceUrl: media.sourceUrl, verifiedAt: media.verifiedAt };
}
