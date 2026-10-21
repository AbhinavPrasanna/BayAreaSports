import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { parseDatabaseEnv, parseWorkerEnv } from '../src/server/config/env';
import { readReadiness } from '../src/server/db/readiness';

test('production secrets load from files; conflicts and unreadable files fail without leaking paths or contents', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bayline-test-'));
  const database = path.join(directory, 'database');
  const key = path.join(directory, 'key');
  try {
    await writeFile(database, 'postgresql://test:synthetic-only@db:5432/bayline\n');
    await writeFile(key, 'synthetic-key-only\n');
    const env = { DATABASE_URL_FILE: database, BALLDONTLIE_API_KEY_FILE: key };
    assert.equal(parseDatabaseEnv(env).DATABASE_URL, 'postgresql://test:synthetic-only@db:5432/bayline');
    assert.equal(parseWorkerEnv(env).BALLDONTLIE_API_KEY, 'synthetic-key-only');
    assert.throws(() => parseDatabaseEnv({ ...env, DATABASE_URL: 'postgresql://other:secret@db/db' }), /Invalid server configuration: DATABASE_URL/);
    assert.throws(() => parseWorkerEnv({ ...env, BALLDONTLIE_API_KEY_FILE: path.join(directory, 'missing') }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /BALLDONTLIE_API_KEY/);
      assert.doesNotMatch(error.message, /missing|bayline-test|synthetic/);
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('readiness fails closed until worker, all feeds, off-server backup and restore proof are fresh', async t => {
  const db = await PGlite.create();
  const pool = db as unknown as Pick<Pool, 'query'>;
  try {
    for (const file of ['001_foundation.sql', '002_game_ingestion.sql', '003_operations.sql']) {
      await db.exec(await readFile(`migrations/${file}`, 'utf8'));
    }
    assert.equal((await readReadiness(pool)).status, 'degraded');
    const reset = async () => db.exec(`
      INSERT INTO worker_heartbeats(worker_name,last_seen_at) VALUES ('scheduler',now()) ON CONFLICT(worker_name) DO UPDATE SET last_seen_at=now();
      UPDATE ingestion_state SET last_success_at=now();
      INSERT INTO operational_checks(name) VALUES ('backup'),('restore') ON CONFLICT(name) DO UPDATE SET succeeded_at=now();`);
    await reset();
    assert.equal((await readReadiness(pool)).status, 'ok');
    for (const [label, staleSql, field] of [
      ['stale worker', "UPDATE worker_heartbeats SET last_seen_at=now()-interval '4 minutes'", 'worker'],
      ['stale league feed', "UPDATE ingestion_state SET last_success_at=now()-interval '11 minutes' WHERE league='wnba'", 'feeds'],
      ['stale backup', "UPDATE operational_checks SET succeeded_at=now()-interval '9 hours' WHERE name='backup'", 'backup'],
      ['stale restore proof', "UPDATE operational_checks SET succeeded_at=now()-interval '36 days' WHERE name='restore'", 'restore'],
    ] as const) {
      await t.test(label, async () => {
        await reset(); await db.exec(staleSql);
        const result = await readReadiness(pool);
        assert.equal(result.status, 'degraded'); assert.equal(result.checks[field], false);
      });
    }
  } finally { await db.close(); }
});
