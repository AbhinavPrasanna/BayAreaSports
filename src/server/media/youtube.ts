import { z } from 'zod';
import type { FreeLeague } from '../../shared/games';

// Resolve these exact league-owned handles, never a display-name search.
export const officialChannels = {
  nba: { handle: '@NBA', label: 'NBA' },
  nfl: { handle: '@NFL', label: 'NFL' },
  wnba: { handle: '@WNBA', label: 'WNBA' },
} as const;
export const channelSchema = z.object({ id: z.string().regex(/^UC[\w-]{22}$/), uploads: z.string().regex(/^UU[\w-]{22}$/) });
export type OfficialChannel = z.infer<typeof channelSchema>;
const id = z.string().regex(/^[\w-]{11}$/);
const snippet = z.object({ title: z.string().min(1).max(200), channelId: z.string(), publishedAt: z.string().datetime(), liveBroadcastContent: z.string().optional() });
const videoSchema = z.object({ id, snippet, status: z.object({ privacyStatus: z.string(), uploadStatus: z.string(), embeddable: z.boolean() }), contentDetails: z.object({ duration: z.string(), regionRestriction: z.object({ allowed: z.array(z.string()).optional(), blocked: z.array(z.string()).optional() }).optional() }) });
export type YouTubeVideo = z.infer<typeof videoSchema>;
export interface Upload { id: string; title: string; publishedAt: string; }
export class YouTubeFailure extends Error {
  constructor(public readonly code: string, public readonly retryMs?: number) { super(code); }
}

export class YouTubeClient {
  constructor(private readonly key: string, private readonly reserve: () => Promise<void>, private readonly signal: AbortSignal, private readonly request: typeof fetch = fetch) {}
  private async get(endpoint: 'channels' | 'playlistItems' | 'videos', params: Record<string, string>): Promise<unknown> {
    this.signal.throwIfAborted();
    await this.reserve();
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    // The key never enters URLs, browser code, request logs or stored metadata.
    try {
      const response = await this.request(url, { headers: { 'X-Goog-Api-Key': this.key }, signal: AbortSignal.any([this.signal, AbortSignal.timeout(5000)]), redirect: 'error' });
      if (!response.ok) {
        let quota = false;
        try { const body = await response.json(); quota = (body?.error?.errors ?? []).some((e: {reason?: string}) => ['quotaExceeded','dailyLimitExceeded'].includes(e.reason ?? '')); } catch { /* Untrusted body is never logged. */ }
        if (quota) throw new YouTubeFailure('YOUTUBE_QUOTA', 86400_000);
        if (response.status === 401 || response.status === 403) throw new YouTubeFailure('YOUTUBE_AUTH', 21600_000);
        if (response.status === 429) throw new YouTubeFailure('YOUTUBE_RATE_LIMIT', 3600_000);
        throw new YouTubeFailure('YOUTUBE_HTTP');
      }
      return await response.json();
    } catch (error) {
      if (error instanceof YouTubeFailure) throw error;
      throw new YouTubeFailure('YOUTUBE_NETWORK');
    }
  }
  async channel(league: FreeLeague): Promise<OfficialChannel> {
    const result = z.object({ items: z.array(z.object({ id: z.string(), snippet: z.object({ customUrl: z.string() }), contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string() }) }) })).length(1) }).parse(await this.get('channels', { part: 'snippet,contentDetails', forHandle: officialChannels[league].handle }));
    const item = result.items[0];
    if (item.snippet.customUrl.toLowerCase() !== officialChannels[league].handle.toLowerCase()) throw new YouTubeFailure('YOUTUBE_CHANNEL');
    return channelSchema.parse({ id: item.id, uploads: item.contentDetails.relatedPlaylists.uploads });
  }
  async uploads(channel: OfficialChannel, since: number): Promise<Upload[]> {
    const uploads: Upload[] = [];
    let pageToken = '';
    const seen = new Set<string>();
    // Up to 150 recent uploads per channel; polling catches busy NFL upload bursts.
    for (let page = 0; page < 3; page++) {
      const result = z.object({ nextPageToken: z.string().optional(), items: z.array(z.object({ contentDetails: z.object({ videoId: id }), snippet: z.object({ title: z.string(), publishedAt: z.string().datetime(), videoOwnerChannelId: z.string().optional() }) })).max(50) }).parse(await this.get('playlistItems', { part: 'snippet,contentDetails', playlistId: channel.uploads, maxResults: '50', ...(pageToken ? { pageToken } : {}) }));
      for (const item of result.items) if (!item.snippet.videoOwnerChannelId || item.snippet.videoOwnerChannelId === channel.id) uploads.push({ id: item.contentDetails.videoId, title: item.snippet.title, publishedAt: item.snippet.publishedAt });
      if (!result.nextPageToken || result.items.some(item => Date.parse(item.snippet.publishedAt) < since)) break;
      if (seen.has(result.nextPageToken)) throw new YouTubeFailure('YOUTUBE_PAGINATION');
      seen.add(result.nextPageToken); pageToken = result.nextPageToken;
    }
    return uploads;
  }
  async videos(ids: string[]): Promise<YouTubeVideo[]> {
    const unique = [...new Set(ids)];
    if (unique.some(value => !id.safeParse(value).success) || unique.length > 50) throw new YouTubeFailure('YOUTUBE_IDS');
    if (!unique.length) return [];
    const result = z.object({ items: z.array(videoSchema).max(50) }).parse(await this.get('videos', { part: 'snippet,status,contentDetails', id: unique.join(',') }));
    if (result.items.some(item => !unique.includes(item.id))) throw new YouTubeFailure('YOUTUBE_IDS');
    return result.items;
  }
}
