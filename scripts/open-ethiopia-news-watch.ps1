$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$browserUrl = "http://127.0.0.1:3000"
$launchTraceLog = Join-Path $projectRoot ".codex-open-launch.log"
$ensureScriptPath = Join-Path $PSScriptRoot "ensure-ethiopia-news-watch-server.ps1"

function Get-EdgePath {
  $preferredPaths = @(
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($preferredPath in $preferredPaths) {
    if (Test-Path $preferredPath) {
      return $preferredPath
    }
  }

  try {
    return (Get-Command msedge.exe -ErrorAction Stop).Source
  } catch {
    return $null
  }
}

function Write-LaunchTrace {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $timestamp = (Get-Date).ToString("o")
  Add-Content -LiteralPath $launchTraceLog -Value "$timestamp $Message"
}

function Open-InBrowser {
  Write-LaunchTrace "browser:open"

  $edgePath = Get-EdgePath

  if ($edgePath) {
    Start-Process -FilePath $edgePath -ArgumentList @("--new-tab", $browserUrl) | Out-Null
    return
  }

  Start-Process -FilePath "explorer.exe" -ArgumentList $browserUrl | Out-Null
}

function Start-ServerBootstrap {
  if (-not (Test-Path $ensureScriptPath)) {
    Write-LaunchTrace "bootstrap:missing-script"
    return
  }

  Start-Process -FilePath "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList @(
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      ('"{0}"' -f $ensureScriptPath)
    ) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden | Out-Null

  Write-LaunchTrace "bootstrap:started"
}

if (Test-Path $launchTraceLog) {
  Remove-Item -LiteralPath $launchTraceLog -Force
}

try {
  Write-LaunchTrace "launcher:start"
  Open-InBrowser
  Start-ServerBootstrap
  Write-LaunchTrace "launcher:exit"
  exit 0
} catch {
  Write-LaunchTrace "launcher:error $($_.Exception.Message)"
  exit 1
}
