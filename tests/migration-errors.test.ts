import test from 'node:test';
import assert from 'node:assert/strict';
import { MigrationChecksumError, migrationFailure } from '../src/server/db/migration-errors';
import { createLogRedactor } from '../scripts/compose-log';

test('migration diagnostics retain SQLSTATE and stage without raw database error fields', () => {
  const result = migrationFailure({ code: '28P01', message: 'private-password', detail: 'private-url', stack: 'private-stack' },
    { stage: 'connect', databaseTarget: 'compose_service' });
  assert.equal(result.code, '28P01');
  assert.equal(result.stage, 'connect');
  assert.equal(result.database_target, 'compose_service');
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test('migration error messages are included only through the credential redactor', () => {
  const result = migrationFailure(new Error('Failed connection with private-password'), { stage: 'connect' }, createLogRedactor(['private-password']));
  assert.equal(result.message, 'Failed connection with [REDACTED]');
});

test('migration diagnostics classify checksum mismatches and suppress unknown error values', () => {
  assert.equal(migrationFailure(new MigrationChecksumError(), { stage: 'verify' }).code, 'MIGRATION_CHECKSUM_MISMATCH');
  const result = migrationFailure({ code: 'private-password', message: 'private-password' }, { stage: 'apply', migration: '001_foundation.sql' });
  assert.equal(result.code, 'UNKNOWN');
  assert.equal(result.migration, '001_foundation.sql');
  assert.doesNotMatch(JSON.stringify(result), /private-password/);
});
