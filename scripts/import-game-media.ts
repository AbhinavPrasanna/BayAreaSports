import { loadLocalEnvironment } from '../src/server/config/load-env';
import { closePool, getPool } from '../src/server/db/pool';
import { importReviewedMedia, loadReviewedMedia } from '../src/server/media/reviewed-media';

async function main() {
  loadLocalEnvironment();
  const entries = loadReviewedMedia(process.argv[2]);
  try { console.log(JSON.stringify(await importReviewedMedia(getPool(), entries))); }
  finally { await closePool(); }
}
main().catch(() => { console.error('Media import failed. Check reviewed entries, database availability and migration 004. Connection details omitted.'); process.exitCode = 1; });
