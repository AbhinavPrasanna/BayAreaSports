#!/usr/bin/env python3
"""Read the provider key from SSH stdin, never a command argument or release archive."""
import json
import os
from pathlib import Path
import secrets
import sys

if os.geteuid() != 0:
    raise SystemExit('Root is required')
value = json.load(sys.stdin).get('provider_key', '').strip()
if not value or len(value) > 4096 or '\n' in value or '\r' in value:
    raise SystemExit('Invalid provider key; value omitted')
directory = Path('/opt/bayline/deploy/secrets')
directory.mkdir(mode=0o700, parents=True, exist_ok=True)
directory.chmod(0o700)
password = directory / 'postgres-password'
if not password.exists():
    descriptor = os.open(password, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(secrets.token_hex(24))
for path, content in [
    (directory / 'database-url', 'postgresql://bayline:' + password.read_text().strip() + '@db:5432/bayline'),
    (directory / 'provider-key', value),
]:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(content)
# Compose file-backed secrets preserve host modes. Containers run as different
# non-root UIDs, so allow read on the file, guarded by its root-only host parent.
for path in directory.iterdir():
    path.chmod(0o444)
print('Production secrets installed; values omitted.')
