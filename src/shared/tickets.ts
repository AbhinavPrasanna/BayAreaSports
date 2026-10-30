import { z } from 'zod';
import type { StoredGame } from './games';

export function ticketmasterEventId(value: string): string | null {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname!=='www.ticketmaster.com'||url.username||url.password||url.port||url.search||url.hash) return null;
    return url.pathname.match(/^\/(?:[a-z0-9-]+\/)?event\/([A-Za-z0-9_-]{8,40})\/?$/)?.[1]??null;
  } catch { return null; }
}

export const ticketSchema=z.object({
  eventId:z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  url:z.string().url(),
  startsAt:z.string().datetime(),
  venue:z.string().trim().min(1).max(120),
  verifiedAt:z.string().datetime(),
}).refine(value=>ticketmasterEventId(value.url)===value.eventId,'Use the matching Ticketmaster event page, without tracking or redirect parameters.');
export type GameTicket=z.infer<typeof ticketSchema>;

/** The parent reviewed-media entry also checks league, provider ID and both team IDs. */
export function ticketForGame(game:StoredGame,now=Date.now(),raw:unknown=game.media?.ticket):GameTicket|null {
  if(game.status!=='scheduled'||!game.startsAt||Date.parse(game.startsAt)<=now)return null;
  const parsed=ticketSchema.safeParse(raw);
  if(!parsed.success)return null;
  const ticket=parsed.data,age=now-Date.parse(ticket.verifiedAt);
  if(Date.parse(ticket.startsAt)!==Date.parse(game.startsAt)||age< -300_000||age>30*86400_000)return null;
  return ticket;
}
