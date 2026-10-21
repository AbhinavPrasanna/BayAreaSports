import { parseGamesQuery } from '@/server/db/game-query';
import { listGames } from '@/server/db/games';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const query = parseGamesQuery(new URL(request.url).searchParams);
  if (!query.success) return Response.json({ error: 'Use a supported league/view and valid YYYY-MM-DD dates spanning at most 31 days.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try { return Response.json(await listGames(query.data), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'The scoreboard is temporarily unavailable. Saved scores will return when the database is reachable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
