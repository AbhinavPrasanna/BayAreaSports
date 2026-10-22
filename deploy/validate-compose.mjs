import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const pinned = 'example.invalid/bayline@sha256:' + 'a'.repeat(64);
const result = spawnSync('docker', ['compose', '--env-file', 'deploy/production.env.example', '-f', 'deploy/compose.production.yaml', 'config', '--format', 'json'], {
  encoding: 'utf8', env: { ...process.env, WEB_IMAGE: pinned, WORKER_IMAGE: pinned, CADDY_IMAGE: pinned, POSTGRES_IMAGE: pinned, COMPOSE_PROFILES: 'public' },
});
if (result.status !== 0) throw new Error('Production Compose validation failed; configuration output omitted');
const config = JSON.parse(result.stdout);
assert.equal(config.networks.database.internal, true);
for (const name of ['db', 'web', 'worker', 'migrate']) assert.equal(config.services[name].ports?.length ?? 0, 0, `${name} must not publish host ports`);
assert.deepEqual(config.services.caddy.ports.map(port => port.published).sort(), ['443', '80']);
for (const [name, service] of Object.entries(config.services)) {
  assert.ok(!service.build, `${name} must use a prebuilt image`);
  assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
  assert.equal(service.restart, name === 'migrate' ? 'no' : 'unless-stopped');
  assert.equal(service.logging.options['max-size'], '10m');
  assert.equal(service.logging.options['max-file'], '3');
  for (const mount of service.tmpfs ?? []) assert.ok(mount.startsWith('/'), `Invalid tmpfs mount in ${name}`);
}
assert.deepEqual(Object.keys(config.services.db.networks), ['database']);
assert.ok(!config.services.web.secrets.some(secret => secret.source === 'provider_key'));
assert.ok(config.services.worker.secrets.some(secret => secret.source === 'provider_key'));
assert.ok(config.services.worker.secrets.some(secret => secret.source === 'youtube_key'));
assert.ok(!config.services.web.secrets.some(secret => secret.source === 'youtube_key'));
assert.equal(config.services.web.tmpfs.length, 2);
console.log('Production topology, pinned images, secret isolation, restart policies and log limits verified.');
