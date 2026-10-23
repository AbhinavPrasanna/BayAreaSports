import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { freeLeagues, type FreeLeague } from '../../shared/games';

type Environment = Record<string, string | undefined>;
const databaseUrl = z.string().url().refine(value => {
  try { return ['postgres:', 'postgresql:'].includes(new URL(value).protocol); }
  catch { return false; }
});
const databaseSchema = z.object({ DATABASE_URL: databaseUrl });
const workerSchema = databaseSchema.extend({
  BALLDONTLIE_API_KEY: z.string().trim().min(1),
  ENABLED_LEAGUES: z.string().default('nba,nfl,wnba').transform(value => value.split(',').map(v => v.trim())).refine(values => values.length > 0 && new Set(values).size === values.length && values.every(value => (freeLeagues as readonly string[]).includes(value))),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(3600).default(60),
  YOUTUBE_API_KEY: z.preprocess(value => value === '' ? undefined : value, z.string().trim().regex(/^[A-Za-z0-9_-]{20,200}$/).optional()),
  HIGHLIGHTS_ENABLED: z.enum(['true','false']).default('true').transform(value => value === 'true'),
  PLAYER_STATS_LEAGUES: z.string().default('').transform(value=>value.split(',').map(v=>v.trim()).filter(Boolean)).refine(values=>new Set(values).size===values.length&&values.every(v=>(freeLeagues as readonly string[]).includes(v))),
  PLAYER_STATUS_LEAGUES: z.string().default('').transform(value=>value.split(',').map(v=>v.trim()).filter(Boolean)).refine(values=>new Set(values).size===values.length&&values.every(v=>(freeLeagues as readonly string[]).includes(v))),
});

export class ConfigurationError extends Error {
  constructor(fields: string[]) {
    super(`Invalid server configuration: ${[...new Set(fields)].join(', ')}. Check .env.example; values are intentionally omitted.`);
    this.name = 'ConfigurationError';
  }
}

function validate<T>(schema: z.ZodType<T>, env: Environment): T {
  const result = schema.safeParse(env);
  if (!result.success) throw new ConfigurationError(result.error.issues.map(issue => String(issue.path[0] ?? 'environment')));
  return result.data;
}

function withSecrets(env: Environment, keys: string[]): Environment {
  const resolved = { ...env };
  for (const key of keys) {
    if (!env[`${key}_FILE`]) continue;
    if (env[key]) throw new ConfigurationError([key]);
    try { resolved[key] = readFileSync(env[`${key}_FILE`]!, 'utf8').trim(); }
    catch { throw new ConfigurationError([key]); }
  }
  return resolved;
}
export function parseDatabaseEnv(env: Environment = process.env) { return validate(databaseSchema, withSecrets(env, ['DATABASE_URL'])); }
export function parseWorkerEnv(env: Environment = process.env) {
  const result = validate(workerSchema, withSecrets(env, ['DATABASE_URL', 'BALLDONTLIE_API_KEY', 'YOUTUBE_API_KEY']));
  if(result.PLAYER_STATS_LEAGUES.some(v=>!result.ENABLED_LEAGUES.includes(v)))throw new ConfigurationError(['PLAYER_STATS_LEAGUES']);
  if(result.PLAYER_STATUS_LEAGUES.some(v=>!result.ENABLED_LEAGUES.includes(v)))throw new ConfigurationError(['PLAYER_STATUS_LEAGUES']);
  return { ...result, ENABLED_LEAGUES: result.ENABLED_LEAGUES as FreeLeague[],PLAYER_STATS_LEAGUES:result.PLAYER_STATS_LEAGUES as FreeLeague[],PLAYER_STATUS_LEAGUES:result.PLAYER_STATUS_LEAGUES as FreeLeague[] };
}
