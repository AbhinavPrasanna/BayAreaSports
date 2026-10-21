import { freeLeagues, type FreeLeague } from '@/shared/games';
import { findGame } from '@/server/db/games';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(_request: Request, context: { params: Promise<{ league: string; id: string }> }) {
  const { league, id } = await context.params;
  if (!(freeLeagues as readonly string[]).includes(league) || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) {
    return Response.json({ error: 'Game not found.' }, { status: 404, headers });
  }
  try {
    const game = await findGame(league as FreeLeague, Number(id));
    if (!game) return Response.json({ error: 'Game not found.' }, { status: 404, headers });
    return Response.json({ data: game }, { headers });
  } catch { return Response.json({ error: 'Game details are temporarily unavailable.' }, { status: 503, headers }); }
}
