import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogRedactor } from '../scripts/compose-log';

test('startup logging redacts known credentials and their URL-encoded forms', () => {
  const redact = createLogRedactor(['sample/key+value', 'database-secret', undefined]);
  const safe = redact('sample/key+value sample%2Fkey%2Bvalue database-secret');
  assert.equal(safe, '[REDACTED] [REDACTED] [REDACTED]');
});

test('startup logging redacts unknown PostgreSQL passwords while preserving useful errors', () => {
  const redact = createLogRedactor([]);
  assert.equal(redact('failed postgresql://bayline:other-password@db:5432/bayline ECONNREFUSED'),
    'failed postgresql://bayline:[REDACTED]@db:5432/bayline ECONNREFUSED');
});
