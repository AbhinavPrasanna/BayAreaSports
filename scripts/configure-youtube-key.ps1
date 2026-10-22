[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path $PSScriptRoot -Parent
$directory = Join-Path $repoPath '.secrets'
$keyPath = Join-Path $directory 'youtube-key.dpapi'
$secureKey = $null
try {
    $secureKey = Read-Host 'Paste the restricted YouTube Data API key (input is hidden)' -AsSecureString
    $taskCredential = [System.Net.NetworkCredential]::new('', $secureKey)
    if ($taskCredential.Password -notmatch '^[A-Za-z0-9_-]{20,200}$') { throw 'The key format is invalid. Value omitted.' }
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $taskAccount = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $directory /inheritance:r /grant:r "${taskAccount}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the secret directory.' }
    $encrypted = ConvertFrom-SecureString -SecureString $secureKey
    [System.IO.File]::WriteAllText($keyPath, $encrypted)
    & icacls $keyPath /inheritance:r /grant:r "${taskAccount}:F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the encrypted key file.' }
    Write-Host 'YouTube key encrypted for this Windows account. No network request was made.'
    Write-Host 'Return to chat and say: YouTube key configured.'
}
finally {
    if ($null -ne $secureKey) { $secureKey.Dispose() }
    Remove-Variable taskCredential,encrypted -ErrorAction SilentlyContinue
}
