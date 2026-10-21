import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';

const password = randomBytes(24).toString('hex');
const content = `POSTGRES_PASSWORD=${password}\n# Optional host-process URL; requires compose.host-db.yaml.\nDATABASE_URL=postgresql://bayline:${password}@127.0.0.1:15432/bayline\nENABLED_LEAGUES=nba,nfl,wnba\nWORKER_INTERVAL_SECONDS=60\n`;
try {
  await fs.writeFile('.env', content, { flag: 'wx', mode: 0o600 });
  console.log('Created ignored .env with a random local database password. Provider key is not stored here.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env preserved.');
}
