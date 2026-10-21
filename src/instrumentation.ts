export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { parseDatabaseEnv } = await import('./server/config/env');
    parseDatabaseEnv();
  }
}
