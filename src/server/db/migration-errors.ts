export type MigrationStage = 'configuration' | 'connect' | 'lock' | 'history' | 'read_files' | 'verify' | 'apply';

export class MigrationChecksumError extends Error {}

const knownCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENOENT', 'EACCES']);
const hints: Record<string, string> = {
  '28P01': 'Database password does not match the existing PostgreSQL role. Preserve the data volume while checking credentials.',
  '3D000': 'The configured database does not exist.',
  '42P07': 'A migration tried to create an existing database object. Check migration history before changing the schema.',
  '42501': 'The database role lacks permission for this operation.',
  '42601': 'A migration contains invalid SQL.',
  ECONNREFUSED: 'PostgreSQL refused the connection. Check the database target and readiness.',
  ENOTFOUND: 'The database hostname could not be resolved.',
  EAI_AGAIN: 'Database hostname resolution temporarily failed.',
  ETIMEDOUT: 'The database connection timed out.',
  ENOENT: 'A required migration file or directory was not found.',
  EACCES: 'The operating system denied database or migration-file access. Check the reported stage.',
  MIGRATION_CHECKSUM_MISMATCH: 'An applied migration changed. Restore it and add a new migration instead.',
};

export function migrationFailure(error: unknown, context: {
  stage: MigrationStage;
  migration?: string;
  databaseTarget?: 'compose_service' | 'loopback' | 'other';
}, sanitizeMessage?: (message: string) => string) {
  const candidate = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const code = error instanceof MigrationChecksumError ? 'MIGRATION_CHECKSUM_MISMATCH'
    : typeof candidate === 'string' && (knownCodes.has(candidate) || /^(?:[0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(candidate)) ? candidate : 'UNKNOWN';
  return {
    event: 'migration_failed',
    stage: context.stage,
    code,
    ...(context.migration ? { migration: context.migration } : {}),
    ...(context.databaseTarget ? { database_target: context.databaseTarget } : {}),
    ...(sanitizeMessage && error instanceof Error ? { message: sanitizeMessage(error.message).slice(0, 1000) } : {}),
    hint: hints[code] ?? 'Use the reported stage, code, and redacted message to identify the failing operation.',
  };
}
