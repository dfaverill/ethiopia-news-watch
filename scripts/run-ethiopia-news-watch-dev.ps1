$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$stdoutLog = Join-Path $projectRoot ".codex-open-local.out"
$stderrLog = Join-Path $projectRoot ".codex-open-local.err"

Set-Location -LiteralPath $projectRoot

if (Test-Path $stdoutLog) {
  Remove-Item -LiteralPath $stdoutLog -Force
}

if (Test-Path $stderrLog) {
  Remove-Item -LiteralPath $stderrLog -Force
}

& npm.cmd run dev -- --hostname 127.0.0.1 --port 3000 1>> $stdoutLog 2>> $stderrLog
