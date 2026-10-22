import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connection } from './remote.mjs';

const keyPath = fileURLToPath(new URL('../../.secrets/youtube-key.dpapi', import.meta.url));
if (!existsSync(keyPath)) throw new Error('Run scripts/configure-youtube-key.ps1 first.');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
// A PowerShell 7 parent may pass a module path that omits Windows PowerShell's
// built-in modules. Resolve these from the child shell's own installation.
const decrypt = `$ErrorActionPreference='Stop';Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1');$s=ConvertTo-SecureString -String ([IO.File]::ReadAllText(${quote(keyPath)}));try{[Console]::Write(([System.Net.NetworkCredential]::new('',$s)).Password)}finally{$s.Dispose()}`;
const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(decrypt,'utf16le').toString('base64')], { encoding:'utf8',windowsHide:true });
if (result.status !== 0 || !/^[A-Za-z0-9_-]{20,200}$/.test(result.stdout)) throw new Error('Unable to decrypt the key for this Windows account; values omitted.');
const directory = fileURLToPath(new URL('../../.secrets/youtube-ssh', import.meta.url));
try {
  const remote = connection('bayline-mvp-prod-01', directory);
  remote.copy(fileURLToPath(new URL('../enable-youtube.py', import.meta.url)), '/tmp/bayline-enable-youtube.py');
  const activated = remote.exec('sudo python3 /tmp/bayline-enable-youtube.py', { input:JSON.stringify({youtube_key:result.stdout}),timeout:240000 });
  if (activated.status !== 0) throw new Error(activated.stderr.trim().slice(-500) || 'Activation failed; output omitted.');
  console.log(activated.stdout.trim());
} finally {
  result.stdout = '';
  // Keep short-lived SSH material encrypted at rest, including after failure.
  const identity = directory + '/identity';
  if (existsSync(identity)) {
    const protect = `$ErrorActionPreference='Stop';Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1');Add-Type -AssemblyName System.Security;$p=${quote(identity)};$b=[IO.File]::ReadAllBytes($p);try{[IO.File]::WriteAllBytes($p,[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))}finally{[Array]::Clear($b,0,$b.Length)}`;
    const saved = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(protect,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
    if(saved.status!==0) throw new Error('Could not encrypt temporary SSH identity. Restrict its .secrets directory before closing.');
  }
}
