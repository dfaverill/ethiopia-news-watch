$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$stdoutLog = Join-Path $projectRoot ".codex-open-local.out"
$stderrLog = Join-Path $projectRoot ".codex-open-local.err"
$preferredNodePath = "C:\Program Files\nodejs\node.exe"
$nextBin = Join-Path $projectRoot "node_modules\next\dist\bin\next"

Set-Location -LiteralPath $projectRoot

if (Test-Path $stdoutLog) {
  Remove-Item -LiteralPath $stdoutLog -Force
}

if (Test-Path $stderrLog) {
  Remove-Item -LiteralPath $stderrLog -Force
}

$nodePath =
  if (Test-Path $preferredNodePath) {
    $preferredNodePath
  } else {
    (Get-Command node.exe -ErrorAction Stop).Source
  }

$env:HOST = "127.0.0.1"
$env:PORT = "3000"

& $nodePath $nextBin "start" "--hostname" "127.0.0.1" "--port" "3000" 1>> $stdoutLog 2>> $stderrLog
