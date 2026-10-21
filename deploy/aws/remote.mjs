import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function aws(args, { input, timeout = 30_000 } = {}) {
  const result = spawnSync('aws', [...args, '--region', 'us-west-2', '--output', 'json', '--no-cli-pager'], {
    input, encoding: 'utf8', timeout, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`AWS operation failed: ${args.slice(0, 2).join(' ')} (output omitted)`);
  return JSON.parse(result.stdout || '{}');
}

export function connection(instance, directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { accessDetails: access } = aws(['lightsail', 'get-instance-access-details', '--instance-name', instance, '--protocol', 'ssh']);
  const identity = path.resolve(directory, 'identity');
  const certificate = identity + '-cert.pub';
  const knownHosts = path.resolve(directory, 'known_hosts');
  writeFileSync(identity, access.privateKey, { mode: 0o600 });
  writeFileSync(certificate, access.certKey, { mode: 0o600 });
  if (process.platform === 'win32') {
    const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    for (const file of [identity, certificate]) {
      const acl = spawnSync('icacls', [file, '/inheritance:r', '/grant:r', `${account}:(R,W)`], { encoding: 'utf8', windowsHide: true });
      if (acl.status !== 0) throw new Error('Could not restrict temporary SSH key permissions');
    }
  }
  if (access.hostKeys?.length) {
    writeFileSync(knownHosts, access.hostKeys.map(host => {
      const key = host.publicKey.includes(' ') ? host.publicKey : `${host.algorithm} ${host.publicKey}`;
      return `${access.ipAddress} ${key}`;
    }).join('\n') + '\n');
  }
  const options = ['-i', identity, '-o', `CertificateFile=${certificate}`, '-o', `UserKnownHostsFile=${knownHosts}`,
    '-o', `StrictHostKeyChecking=${existsSync(knownHosts) ? 'yes' : 'accept-new'}`, '-o', 'KexAlgorithms=curve25519-sha256',
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15'];
  const target = `${access.username}@${access.ipAddress}`;
  return {
    ip: access.ipAddress,
    exec(command, { input, timeout = 60_000 } = {}) {
      const result = spawnSync('ssh', [...options, target, command], { input, encoding: 'utf8', timeout, windowsHide: true });
      return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.code };
    },
    copy(localFile, remoteFile) {
      if (!/^\/tmp\/bayline-[a-z0-9.-]+$/.test(remoteFile)) throw new Error('Invalid release transfer target');
      const result = spawnSync('scp', [...options, localFile, `${target}:${remoteFile}`], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
      if (result.status !== 0) throw new Error('Release transfer failed (output omitted)');
    },
  };
}
