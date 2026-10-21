[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path $PSScriptRoot -Parent
$keyPath = [System.IO.Path]::GetFullPath((Join-Path $repoPath '..\..\work\.secrets\balldontlie-key.dpapi'))
$previousKey = $env:BALLDONTLIE_API_KEY
$secureKey = $null
Push-Location $repoPath
try {
    & node scripts/check-docker.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Docker preflight failed. Follow the instructions above, then rerun this launcher.' }
    & node scripts/setup-env.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local environment setup failed.' }
    if ([string]::IsNullOrWhiteSpace($env:BALLDONTLIE_API_KEY)) {
        if (-not (Test-Path -LiteralPath $keyPath)) { throw 'Set BALLDONTLIE_API_KEY in this session or configure the Windows encrypted key first.' }
        $secureKey = ConvertTo-SecureString -String ([System.IO.File]::ReadAllText($keyPath))
        $credential = [System.Net.NetworkCredential]::new('', $secureKey)
        $env:BALLDONTLIE_API_KEY = $credential.Password
    }
    & node --import tsx scripts/start-compose.ts
    $composeExitCode = $LASTEXITCODE
    if ($composeExitCode -ne 0) {
        throw "Compose startup failed (exit $composeExitCode). Docker passed the earlier engine check. The redacted error output is saved in $repoPath\logs\compose-startup.log."
    }
    Write-Host 'Local app: http://localhost:3000'
}
finally {
    if ($null -eq $previousKey) { Remove-Item Env:BALLDONTLIE_API_KEY -ErrorAction SilentlyContinue }
    else { $env:BALLDONTLIE_API_KEY = $previousKey }
    if ($null -ne $secureKey) { $secureKey.Dispose() }
    Remove-Variable credential -ErrorAction SilentlyContinue
    Pop-Location
}
