import { getPool } from '@/server/db/pool';
import { readReadiness } from '@/server/db/readiness';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const readiness = await readReadiness(getPool());
    return Response.json(readiness, { status: readiness.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
