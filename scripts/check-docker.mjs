import { spawnSync } from 'node:child_process';

// Query only the engine type; never print Docker's environment or raw diagnostics.
const result = spawnSync('docker', ['info', '--format', '{{.OSType}}'], {
  encoding: 'utf8',
  timeout: 10_000,
  windowsHide: true,
});

if (result.error?.code === 'ENOENT') {
  console.error('Docker CLI was not found. Install Docker Desktop, then reopen PowerShell.');
  process.exit(1);
}

if (result.error || result.status !== 0) {
  console.error([
    'Docker engine is not reachable. Open Docker Desktop from the Windows Start menu.',
    'Wait until it reports that the engine is running, then run: docker info --format "{{.OSType}}"',
    'The result must be linux. If Docker Desktop cannot start, run wsl --status in normal PowerShell and check the error shown by Docker Desktop.',
    'No provider key was loaded by this launcher and Compose was not started.',
  ].join('\n'));
  process.exit(1);
}

if (result.stdout.trim() !== 'linux') {
  console.error('Docker is running a non-Linux engine. Switch Docker Desktop to Linux containers, then retry.');
  process.exit(1);
}

console.log('Docker Linux engine is reachable.');
