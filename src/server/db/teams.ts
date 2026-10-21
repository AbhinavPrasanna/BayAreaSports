import 'server-only';
import { getPool } from './pool';

export async function listTeams() {
  const result = await getPool().query<{ league: string; providerId: number; name: string }>('SELECT league, provider_id AS "providerId", name FROM teams WHERE enabled = true ORDER BY league');
  return result.rows;
}
