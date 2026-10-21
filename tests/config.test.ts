import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDatabaseEnv, parseWorkerEnv } from '../src/server/config/env';

const env = { DATABASE_URL: 'postgresql://local:local@localhost:5432/bayline', BALLDONTLIE_API_KEY: 'synthetic-secret' };
test('the web configuration does not require or return the provider key', () => {
  assert.deepEqual(parseDatabaseEnv(env), { DATABASE_URL: env.DATABASE_URL });
});
test('invalid config errors identify fields without exposing credentials', () => {
  assert.throws(() => parseDatabaseEnv({ DATABASE_URL: 'https://user:private-password@host' }), error => error instanceof Error && error.message.includes('DATABASE_URL') && !error.message.includes('private-password'));
  assert.throws(() => parseWorkerEnv({ DATABASE_URL: env.DATABASE_URL }), /BALLDONTLIE_API_KEY/);
});
test('paid leagues and an excessively frequent worker schedule are rejected', () => {
  assert.throws(() => parseWorkerEnv({ ...env, ENABLED_LEAGUES: 'nba,nhl' }), /ENABLED_LEAGUES/);
  assert.throws(() => parseWorkerEnv({ ...env, WORKER_INTERVAL_SECONDS: '10' }), /WORKER_INTERVAL_SECONDS/);
});
