import { readFileSync } from 'node:fs';
import { connection } from './remote.mjs';

if (!process.argv[2]) throw new Error('Pass the ignored temporary SSH credential directory');
const payload = readFileSync(0, 'utf8');
const value = JSON.parse(payload);
if (typeof value.provider_key !== 'string' || !value.provider_key.trim()) throw new Error('Missing provider key; value omitted');
const remote = connection('bayline-mvp-prod-01', process.argv[2]);
const result = remote.exec('sudo python3 /opt/bayline/deploy/install-secrets.py', { input: payload });
if (result.status !== 0) throw new Error('Server secret installation failed; output omitted');
console.log('Production secrets configured over SSH; values omitted.');
