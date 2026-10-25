$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot 'output/public-host/running.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No public hosting session is recorded.'; exit }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
foreach ($entry in $state.processes) {
  $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
  if ($process -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks -and $process.Path -eq $entry.executable) { Stop-Process -Id $process.Id }
}
Remove-Item -LiteralPath $statePath
Write-Output 'Public sharing stopped. Saved lessons are still in output/public-lessons.'
