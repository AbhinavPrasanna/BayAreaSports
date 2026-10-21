import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createLogRedactor } from './compose-log';

const repo = process.cwd();
const logPath = resolve(repo, 'logs/compose-startup.log');
const secrets = [process.env.BALLDONTLIE_API_KEY, process.env.POSTGRES_PASSWORD, process.env.DATABASE_URL];
// Read only local database values for redaction. Do not load .env into the process.
try {
  for (const line of readFileSync(resolve(repo, '.env'), 'utf8').split(/\r?\n/)) {
    const match = /^(?:POSTGRES_PASSWORD|DATABASE_URL)=(.*)$/.exec(line.trim());
    if (match) secrets.push(match[1].replace(/^(['"])(.*)\1$/, '$2'));
  }
} catch {
  console.error('Could not read local .env for log redaction. Run npm run setup first.');
  process.exit(1);
}
const redact = createLogRedactor(secrets);
mkdirSync(resolve(repo, 'logs'), { recursive: true });
writeFileSync(logPath, `Compose startup attempt: ${new Date().toISOString()}\n`, { mode: 0o600 });

function report(line: string) {
  const safe = redact(line);
  appendFileSync(logPath, `${safe}\n`);
  console.log(safe);
}

function runDocker(args: string[], timeout?: number): Promise<number> {
  return new Promise((resolveExit) => {
    // Credentials are inherited through the environment, never command arguments.
    const child = spawn('docker', args, {
      cwd: repo, windowsHide: true, timeout, stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', report);
    }
    child.on('error', () => report('Could not launch the Docker CLI.'));
    child.on('close', (code) => resolveExit(code ?? 1));
  });
}

async function main() {
  const code = await runDocker(['compose', '--progress', 'plain', 'up', '--build', '-d']);
  report(`Compose exit code: ${code ?? 1}`);
  if (code !== 0) {
    report('--- Container state ---');
    await runDocker(['compose', 'ps', '--all'], 15_000);
    report('--- Recent migration and database logs ---');
    await runDocker(['compose', 'logs', '--no-color', '--tail=60', 'migrate', 'db'], 15_000);
  }
  console.log(`Redacted startup log: ${logPath}`);
  process.exitCode = code ?? 1;
}
main().catch(() => {
  console.error(`Startup capture failed. Check the redacted log at ${logPath}.`);
  process.exitCode = 1;
});
