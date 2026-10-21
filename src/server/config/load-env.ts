import { loadEnvConfig } from '@next/env';

export function loadLocalEnvironment() {
  loadEnvConfig(process.cwd());
}
