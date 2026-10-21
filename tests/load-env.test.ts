import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('standalone TypeScript processes load environment configuration and preserve container overrides', () => {
  const expected = 'postgresql://bayline:test-only@db:5432/bayline';
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e',
    'require("./src/server/config/load-env.ts").loadLocalEnvironment(); if (process.env.DATABASE_URL !== process.env.TEST_EXPECTED_DATABASE_URL) process.exit(2);'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, DATABASE_URL: expected, TEST_EXPECTED_DATABASE_URL: expected },
  });
  assert.equal(result.status, 0, 'The standalone worker/migration environment loader must run successfully.');
});
