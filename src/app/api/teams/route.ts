import { listTeams } from '@/server/db/teams';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { return Response.json({ data: await listTeams() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Teams are temporarily unavailable.' }, { status: 503 }); }
}
