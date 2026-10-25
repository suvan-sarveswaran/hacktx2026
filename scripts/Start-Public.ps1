param([switch]$SkipBuild, [int]$Port = 3100)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$hostDir = Join-Path $projectRoot 'output/public-host'
$tunnelExe = Join-Path $projectRoot 'output/tools/cloudflared.exe'
$encoder = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'output/tools/ffmpeg') -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $encoder) { throw 'A current FFmpeg build is required in output/tools/ffmpeg for public hosting. See docs/public-hosting.md.' }
$statePath = Join-Path $hostDir 'running.json'
if (-not (Test-Path -LiteralPath $tunnelExe)) { throw 'Cloudflare tunnel tool is missing from output/tools/cloudflared.exe. Download it from the official cloudflare/cloudflared GitHub release.' }
if (Test-Path -LiteralPath $statePath) {
  $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  foreach ($entry in $previous.processes) {
    $running = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($running -and $running.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks) { throw "Public hosting is already running: $($previous.url). Stop it with scripts/Stop-Public.ps1 first." }
  }
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already in use. Choose a different -Port." }
if (-not $SkipBuild) {
  & pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'Server build failed.' }
  & pnpm build:web
  if ($LASTEXITCODE -ne 0) { throw 'Website build failed.' }
}
New-Item -ItemType Directory -Force -Path $hostDir | Out-Null
$nodeExe = (Get-Command node).Source
$tunnel = $null
$app = $null
$savedEnv = @{}
foreach ($key in @('HOST', 'PORT', 'PUBLIC_ORIGIN', 'LESSON_DATA_DIR', 'FFMPEG_PATH')) { $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
  $tunnel = Start-Process -FilePath $tunnelExe -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $hostDir 'tunnel.out.log') -RedirectStandardError (Join-Path $hostDir 'tunnel.err.log')
  $deadline = (Get-Date).AddSeconds(60)
  $publicUrl = $null
  while ((Get-Date) -lt $deadline) {
    if ($tunnel.HasExited) { throw 'Cloudflare could not start. See output/public-host/tunnel.err.log.' }
    $log = Get-Content -LiteralPath (Join-Path $hostDir 'tunnel.err.log') -Raw -ErrorAction SilentlyContinue
    if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $publicUrl = $Matches[0]; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $publicUrl) { throw 'Cloudflare did not return a public URL within 60 seconds.' }
  $env:HOST = '127.0.0.1'
  $env:PORT = "$Port"
  $env:PUBLIC_ORIGIN = $publicUrl
  $env:LESSON_DATA_DIR = Join-Path $projectRoot 'output/public-lessons'
  $env:FFMPEG_PATH = $encoder.FullName
  # No .env is loaded: each visitor supplies their own provider keys.
  $app = Start-Process -FilePath $nodeExe -ArgumentList @('dist/server.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $hostDir 'server.out.log') -RedirectStandardError (Join-Path $hostDir 'server.err.log')
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($app.HasExited) { throw 'The app could not start. See output/public-host/server.err.log.' }
    try { $check = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2; if ($check.StatusCode -eq 200) { $ready = $true; break } } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw 'The app did not become ready.' }
  $state = @{ url = $publicUrl; port = $Port; processes = @(@{ id = $app.Id; started = $app.StartTime.ToUniversalTime().ToString('o'); executable = $nodeExe }, @{ id = $tunnel.Id; started = $tunnel.StartTime.ToUniversalTime().ToString('o'); executable = $tunnelExe }) }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath
  Write-Output "Public URL: $publicUrl"
  Write-Output 'Keep this computer awake and connected. Stop sharing with scripts/Stop-Public.ps1. Restarting creates a new URL and browser workspace.'
} catch {
  if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id }
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id }
  throw
} finally {
  foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process') }
}
