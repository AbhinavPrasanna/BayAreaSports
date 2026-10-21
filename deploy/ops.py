#!/usr/bin/env python3
"""Root-only host operations. No database/provider secrets appear in arguments or logs."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path('/opt/bayline/deploy')
UTC = dt.timezone.utc


def config():
    values = {}
    for line in (ROOT / 'production.env').read_text().splitlines():
        if line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value.strip()
    return values


def run(args, *, data=None, timeout=90, binary=False):
    result = subprocess.run(args, input=data, capture_output=True, text=not binary, timeout=timeout)
    if result.returncode:
        # Never print subprocess output: diagnostics may contain environment values.
        raise RuntimeError('Operation failed: ' + args[0] + ' ' + args[1])
    return result.stdout


def compose(*args, **kwargs):
    return run(['docker', 'compose', '--env-file', str(ROOT / 'production.env'),
                '-f', str(ROOT / 'compose.production.yaml'), *args], **kwargs)


def aws(*args):
    return run(['aws', '--region', config()['AWS_REGION'], '--cli-connect-timeout', '10',
                '--cli-read-timeout', '60', *args], timeout=180)


def sql(query, database='bayline'):
    return compose('exec', '-T', 'db', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'bayline',
                   '-d', database, '-At', data=query).strip()


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def mark(name, detail):
    sql('INSERT INTO operational_checks(name,detail) VALUES (' + quote(name) + ',' +
        quote(json.dumps(detail)) + '::jsonb) ON CONFLICT(name) DO UPDATE SET succeeded_at=now(),detail=EXCLUDED.detail;')


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def key_ok(key):
    return bool(re.fullmatch(r'postgres/\d{8}T\d{6}Z-[a-f0-9]{12}\.(dump|json)', key))


def backup():
    settings = config()
    bucket = settings['BACKUP_BUCKET']
    token = uuid.uuid4().hex
    stamp = dt.datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')
    prefix = f'postgres/{stamp}-{token[:12]}'
    mark('restore-canary', {'token': token})
    with tempfile.TemporaryDirectory(prefix='bayline-backup-') as directory:
        dump = Path(directory) / 'database.dump'
        with dump.open('wb') as stream:
            result = subprocess.run(['docker', 'compose', '--env-file', str(ROOT / 'production.env'),
                '-f', str(ROOT / 'compose.production.yaml'), 'exec', '-T', 'db', 'pg_dump',
                '-U', 'bayline', '-d', 'bayline', '--format=custom', '--no-owner', '--no-acl'],
                stdout=stream, stderr=subprocess.PIPE, timeout=300)
        if result.returncode or dump.stat().st_size < 100:
            raise RuntimeError('Database dump failed or was empty')
        if dump.stat().st_size > 200 * 1024 * 1024:
            raise RuntimeError('Backup exceeds the 200 MiB MVP storage guard; review retention and costs')
        manifest = {'key': prefix + '.dump', 'sha256': checksum(dump), 'canary': token,
                    'bytes': dump.stat().st_size, 'created_at': dt.datetime.now(UTC).isoformat()}
        metadata = Path(directory) / 'manifest.json'
        metadata.write_text(json.dumps(manifest, indent=2))
        aws('s3', 'cp', str(dump), f's3://{bucket}/{prefix}.dump', '--only-show-errors')
        # Verify a real off-server round trip before declaring the backup successful.
        downloaded = Path(directory) / 'roundtrip.dump'
        aws('s3', 'cp', f's3://{bucket}/{prefix}.dump', str(downloaded), '--only-show-errors')
        if checksum(downloaded) != manifest['sha256']:
            raise RuntimeError('Off-server backup checksum did not match')
        aws('s3', 'cp', str(metadata), f's3://{bucket}/{prefix}.json', '--only-show-errors')
    mark('backup', {'key': prefix + '.json', 'sha256': manifest['sha256'], 'bytes': manifest['bytes']})
    print(json.dumps({'event': 'backup_verified', 'key': prefix + '.json', 'bytes': manifest['bytes']}))


def latest_manifest():
    items = json.loads(aws('s3api', 'list-objects-v2', '--bucket', config()['BACKUP_BUCKET'], '--prefix', 'postgres/')).get('Contents', [])
    keys = sorted(item['Key'] for item in items if item['Key'].endswith('.json') and key_ok(item['Key']))
    if not keys:
        raise RuntimeError('No completed off-server backup exists')
    return keys[-1]


def restore(key, database, *, record=True):
    if not re.fullmatch(r'bayline_restore_\d{14}', database):
        raise RuntimeError('Restore target must be a NEW bayline_restore_YYYYMMDDHHMMSS database')
    if not key_ok(key) or not key.endswith('.json'):
        raise RuntimeError('Invalid backup manifest key')
    bucket = config()['BACKUP_BUCKET']
    with tempfile.TemporaryDirectory(prefix='bayline-restore-') as directory:
        metadata = Path(directory) / 'manifest.json'
        dump = Path(directory) / 'database.dump'
        aws('s3', 'cp', f's3://{bucket}/{key}', str(metadata), '--only-show-errors')
        manifest = json.loads(metadata.read_text())
        if not key_ok(manifest['key']) or not manifest['key'].endswith('.dump') or not re.fullmatch(r'[a-f0-9]{32}', manifest['canary']):
            raise RuntimeError('Invalid backup manifest contents')
        aws('s3', 'cp', f's3://{bucket}/{manifest["key"]}', str(dump), '--only-show-errors')
        if checksum(dump) != manifest['sha256']:
            raise RuntimeError('Downloaded restore checksum did not match')
        # createdb fails if the target already exists. Never drop or overwrite a database.
        compose('exec', '-T', 'db', 'createdb', '-U', 'bayline', database)
        with dump.open('rb') as stream:
            result = subprocess.run(['docker', 'compose', '--env-file', str(ROOT / 'production.env'),
                '-f', str(ROOT / 'compose.production.yaml'), 'exec', '-T', 'db', 'pg_restore',
                '-U', 'bayline', '-d', database, '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl'],
                stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
        if result.returncode:
            raise RuntimeError('Restore failed; isolated target retained for inspection')
        canary = sql("SELECT detail->>'token' FROM operational_checks WHERE name='restore-canary';", database)
        counts = json.loads(sql("SELECT json_build_object('migrations',(SELECT count(*) FROM schema_migrations),'teams',(SELECT count(*) FROM teams WHERE enabled),'games',(SELECT count(*) FROM games));", database))
        if canary != manifest['canary'] or counts['migrations'] < 3 or counts['teams'] != 3 or counts['games'] < 1:
            raise RuntimeError('Restored canary or application-data checks failed')
        sql('ANALYZE;', database)
    evidence = {'database': database, 'manifest': key, 'sha256': manifest['sha256'], 'canary_verified': True, **counts}
    if record:
        mark('restore', evidence)
    print(json.dumps({'event': 'restore_verified', **evidence}))


def prune():
    # Only app-named object versions older than 35 days, after two good backups exist.
    settings = config()
    bucket = settings['BACKUP_BUCKET']
    listing = json.loads(aws('s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', 'postgres/'))
    if sum(key_ok(item['Key']) and item['Key'].endswith('.json') for item in listing.get('Contents', [])) < 2:
        return
    cutoff = dt.datetime.now(UTC) - dt.timedelta(days=35)
    versions = json.loads(aws('s3api', 'list-object-versions', '--bucket', bucket, '--prefix', 'postgres/'))
    for item in versions.get('Versions', []) + versions.get('DeleteMarkers', []):
        if key_ok(item['Key']) and dt.datetime.fromisoformat(item['LastModified'].replace('Z', '+00:00')) < cutoff:
            aws('s3api', 'delete-object', '--bucket', bucket, '--key', item['Key'], '--version-id', item['VersionId'])
    print(json.dumps({'event': 'retention_checked', 'retention_days': 35}))


def promote(database):
    if not database or not re.fullmatch(r'bayline_restore_\d{14}', database):
        raise RuntimeError('Promotion requires a verified timestamped restore database')
    for service in ('web', 'worker', 'migrate'):
        container = compose('ps', '--all', '-q', service).strip()
        if container and run(['docker', 'inspect', '--format', '{{.State.Running}}', container]).strip() == 'true':
            raise RuntimeError('Stop application, worker and migration processes before promotion')
    if sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';") != '0':
        raise RuntimeError('Refusing to replace a populated live database; promotion is for a fresh recovery host only')
    counts = json.loads(sql("SELECT json_build_object('migrations',(SELECT count(*) FROM schema_migrations),'teams',(SELECT count(*) FROM teams WHERE enabled),'games',(SELECT count(*) FROM games));", database))
    canary = sql("SELECT detail->>'token' FROM operational_checks WHERE name='restore-canary';", database)
    if counts['migrations'] < 3 or counts['teams'] != 3 or counts['games'] < 1 or not re.fullmatch(r'[a-f0-9]{32}', canary):
        raise RuntimeError('Restored database failed promotion checks')
    empty = 'bayline_empty_' + dt.datetime.now(UTC).strftime('%Y%m%d%H%M%S')
    # Validated identifiers only; preserve even the empty initial database.
    sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('bayline'," + quote(database) + ") AND pid<>pg_backend_pid();", 'postgres')
    sql(f'ALTER DATABASE bayline RENAME TO {empty};', 'postgres')
    sql(f'ALTER DATABASE {database} RENAME TO bayline;', 'postgres')
    print(json.dumps({'event': 'recovery_database_promoted', 'preserved_empty_database': empty, **counts}))


def watchdog():
    for service in ('web', 'worker', 'db'):
        container = compose('ps', '--all', '-q', service).strip()
        if not container:
            continue
        state = json.loads(run(['docker', 'inspect', '--format', '{{json .State}}', container]))
        if state.get('Running') and state.get('Health', {}).get('Status') == 'unhealthy':
            run(['docker', 'restart', container], timeout=120)
            print(json.dumps({'event': 'unhealthy_container_restarted', 'service': service}))


def wait_healthy(service, deadline=180):
    until = time.monotonic() + deadline
    while time.monotonic() < until:
        container = compose('ps', '--all', '-q', service).strip()
        if container:
            state = json.loads(run(['docker', 'inspect', '--format', '{{json .State}}', container]))
            if state.get('Running') and state.get('Health', {}).get('Status') == 'healthy':
                return container
        time.sleep(3)
    raise RuntimeError('Container did not recover: ' + service)


def restart_proof():
    results = []
    for service in ('web', 'worker', 'db'):
        container = wait_healthy(service)
        previous = int(run(['docker', 'inspect', '--format', '{{.RestartCount}}', container]))
        worker = compose('ps', '-q', 'worker').strip()
        worker_started = run(['docker', 'inspect', '--format', '{{.State.StartedAt}}', worker]).strip()
        state = json.loads(run(['docker', 'inspect', '--format', '{{json .State}}', container]))
        pid = int(state['Pid'])
        if not state['Running'] or pid <= 1:
            raise RuntimeError('Refusing to terminate an invalid container process')
        canary = sql("SELECT detail->>'token' FROM operational_checks WHERE name='restore-canary';")
        # Kill the observed container process from the host. docker stop deliberately
        # suppresses restart policies and would not prove crash recovery.
        os.kill(pid, signal.SIGKILL)
        time.sleep(3)
        wait_healthy(service)
        current = int(run(['docker', 'inspect', '--format', '{{.RestartCount}}', container]))
        if current <= previous:
            raise RuntimeError('Automatic restart counter did not advance: ' + service)
        if service == 'web' and worker_started != run(['docker', 'inspect', '--format', '{{.State.StartedAt}}', worker]).strip():
            raise RuntimeError('Web restart also restarted the worker')
        if sql('SELECT count(*) FROM games;') == '0':
            raise RuntimeError('Stored games disappeared after restart')
        if canary != sql("SELECT detail->>'token' FROM operational_checks WHERE name='restore-canary';"):
            raise RuntimeError('Recovery canary changed after restart')
        results.append({'service': service, 'restart_count_before': previous, 'restart_count_after': current})
        print(json.dumps({'event': 'process_recovered', 'service': service}), flush=True)
    wait_healthy('web')
    wait_healthy('worker')
    mark('restart-proof', {'results': results})
    print(json.dumps({'event': 'restart_proof_passed', 'results': results}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['backup', 'restore', 'promote', 'prune', 'watchdog', 'restart-proof'])
    parser.add_argument('--key')
    parser.add_argument('--database')
    parser.add_argument('--no-record', action='store_true', help='Recovery on a fresh host before live schema exists')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run as root so secret files and Docker access remain restricted')
    if args.action == 'restore':
        restore(args.key or latest_manifest(), args.database or 'bayline_restore_' + dt.datetime.now(UTC).strftime('%Y%m%d%H%M%S'), record=not args.no_record)
    elif args.action == 'backup':
        backup()
        prune()
    elif args.action == 'promote':
        promote(args.database)
    else:
        {'prune': prune, 'watchdog': watchdog, 'restart-proof': restart_proof}[args.action]()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'event': 'operation_failed', 'type': type(error).__name__,
                          'message': str(error) if isinstance(error, RuntimeError) else 'Unexpected failure; raw details omitted'}), file=sys.stderr)
        sys.exit(1)
