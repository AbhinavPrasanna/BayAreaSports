[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path $PSScriptRoot -Parent
$keyPath = [System.IO.Path]::GetFullPath((Join-Path $repoPath '..\..\work\.secrets\balldontlie-key.dpapi'))
$previousKey = $env:BALLDONTLIE_API_KEY
$previousYouTubeKey = $env:YOUTUBE_API_KEY
$secureKey = $null
$secureYouTubeKey = $null
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
    $youtubeKeyPath = Join-Path $repoPath '.secrets\youtube-key.dpapi'
    if ([string]::IsNullOrWhiteSpace($env:YOUTUBE_API_KEY) -and (Test-Path -LiteralPath $youtubeKeyPath)) {
        $secureYouTubeKey = ConvertTo-SecureString -String ([System.IO.File]::ReadAllText($youtubeKeyPath))
        $youtubeCredential = [System.Net.NetworkCredential]::new('', $secureYouTubeKey)
        $env:YOUTUBE_API_KEY = $youtubeCredential.Password
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
    if ($null -eq $previousYouTubeKey) { Remove-Item Env:YOUTUBE_API_KEY -ErrorAction SilentlyContinue }
    else { $env:YOUTUBE_API_KEY = $previousYouTubeKey }
    if ($null -ne $secureKey) { $secureKey.Dispose() }
    if ($null -ne $secureYouTubeKey) { $secureYouTubeKey.Dispose() }
    Remove-Variable credential,youtubeCredential -ErrorAction SilentlyContinue
    Pop-Location
}
