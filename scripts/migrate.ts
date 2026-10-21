import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { loadLocalEnvironment } from '../src/server/config/load-env';
import { ConfigurationError, parseDatabaseEnv } from '../src/server/config/env';
import { MigrationChecksumError, migrationFailure, type MigrationStage } from '../src/server/db/migration-errors';
import { createLogRedactor } from './compose-log';

let stage: MigrationStage = 'configuration';
let migration: string | undefined;
let databaseTarget: 'compose_service' | 'loopback' | 'other' | undefined;
let redactMessage: ((message: string) => string) | undefined;

async function main() {
  loadLocalEnvironment();
  const { DATABASE_URL } = parseDatabaseEnv();
  const database = new URL(DATABASE_URL);
  const hostname = database.hostname;
  redactMessage = createLogRedactor([DATABASE_URL, decodeURIComponent(database.password), process.env.BALLDONTLIE_API_KEY]);
  databaseTarget = hostname === 'db' ? 'compose_service' : ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? 'loopback' : 'other';
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  stage = 'connect';
  await client.connect();
  try {
    stage = 'lock';
    await client.query('SELECT pg_advisory_lock(20261020, 2)');
    stage = 'history';
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    stage = 'read_files';
    const directory = path.resolve('migrations');
    const files = (await readdir(directory)).filter(file => /^\d+_[\w-]+\.sql$/.test(file)).sort();
    for (const file of files) {
      stage = 'read_files';
      migration = file;
      const sql = await readFile(path.join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      stage = 'verify';
      const previous = await client.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE name = $1', [file]);
      if (previous.rows[0]) {
        if (previous.rows[0].checksum !== checksum) throw new MigrationChecksumError();
        continue;
      }
      stage = 'apply';
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    console.log('Database migrations are current.');
  } finally { await client.end(); }
}

main().catch(error => {
  console.error(error instanceof ConfigurationError ? error.message : JSON.stringify(migrationFailure(error, { stage, migration, databaseTarget }, redactMessage)));
  process.exitCode = 1;
});
