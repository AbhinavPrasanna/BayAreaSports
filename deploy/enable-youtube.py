#!/usr/bin/env python3
"""Validate and install a worker-only YouTube key received through SSH stdin."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
import urllib.error

ROOT = Path('/opt/bayline/deploy')


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root is required')
    key = json.load(sys.stdin).get('youtube_key', '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{20,200}', key):
        raise RuntimeError('Invalid key format; value omitted')
    # Validate from the production IP, where the key's IP restriction applies.
    for handle in ('NBA', 'NFL', 'WNBA'):
        request = urllib.request.Request(
            'https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=' + handle,
            headers={'X-Goog-Api-Key': key})
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                items = json.load(response).get('items', [])
            if len(items) != 1 or items[0]['snippet']['customUrl'].lower() != '@' + handle.lower():
                raise RuntimeError('Official channel verification failed')
        except urllib.error.HTTPError as error:
            raise RuntimeError('YouTube validation returned HTTP ' + str(error.code) + '. Check API enablement, quota and key restrictions.') from None
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError('YouTube validation could not connect. No key was installed.') from None
    directory = ROOT / 'secrets'
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    path = directory / 'youtube-key'
    previous = path.read_bytes() if path.exists() else b''
    env = ROOT / 'production.env'
    original_env = env.read_text()
    base = ['docker', 'compose', '--env-file', 'production.env', '-f', 'compose.production.yaml']

    def run(args, timeout=180):
        result = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError('Worker operation failed; output omitted')
        return result.stdout

    def save(target, content, mode):
        temporary = target.with_name(target.name + '.youtube.tmp')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
        temporary.chmod(mode)
        temporary.replace(target)

    # Refuse an old deployment before changing secrets.
    run(base + ['exec', '-T', 'db', 'psql', '-U', 'bayline', '-d', 'bayline', '-v', 'ON_ERROR_STOP=1', '-Atc', 'SELECT count(*) FROM youtube_discovery_state;'])
    try:
        save(path, key.encode(), 0o444)
        lines = [line for line in original_env.splitlines() if not line.startswith('HIGHLIGHTS_ENABLED=')]
        save(env, ('\n'.join(lines) + '\nHIGHLIGHTS_ENABLED=true\n').encode(), 0o600)
        run(base + ['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '150', 'worker'])
        run(base + ['exec', '-T', 'db', 'psql', '-U', 'bayline', '-d', 'bayline', '-v', 'ON_ERROR_STOP=1', '-Atc', "UPDATE youtube_discovery_state SET next_check_at=now(),last_error_code=NULL,consecutive_failures=0;"])
    except Exception:
        save(path, previous, 0o444)
        save(env, original_env.encode(), 0o600)
        run(base + ['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '150', 'worker'])
        raise
    print(json.dumps({'enabled': True, 'official_channels_verified': ['NBA', 'NFL', 'WNBA'], 'worker': 'healthy'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only controlled diagnostics; never echo a response body, URL or key.
        print(str(error) if isinstance(error, RuntimeError) else 'YouTube setup failed; details omitted.', file=sys.stderr)
        raise SystemExit(1)
