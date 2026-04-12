$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 3000
$browserUrl = "http://127.0.0.1:$port"
$healthUrl = "http://127.0.0.1:$port/api/health"
$stdoutLog = Join-Path $projectRoot ".codex-open-local.out"
$stderrLog = Join-Path $projectRoot ".codex-open-local.err"
$buildStdoutLog = Join-Path $projectRoot ".codex-open-build.out"
$buildStderrLog = Join-Path $projectRoot ".codex-open-build.err"
$ensureTraceLog = Join-Path $projectRoot ".codex-open-ensure.log"
$expectedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\').ToLowerInvariant()
$nextBin = Join-Path $projectRoot "node_modules\next\dist\bin\next"
$buildIdPath = Join-Path $projectRoot ".next\BUILD_ID"
$buildRelevantPaths = @(
  (Join-Path $projectRoot "src"),
  (Join-Path $projectRoot "assets"),
  (Join-Path $projectRoot "package.json"),
  (Join-Path $projectRoot "package-lock.json"),
  (Join-Path $projectRoot "next.config.ts"),
  (Join-Path $projectRoot "tsconfig.json")
)

function Get-NodePath {
  $preferred = "C:\Program Files\nodejs\node.exe"

  if (Test-Path $preferred) {
    return $preferred
  }

  return (Get-Command node.exe -ErrorAction Stop).Source
}

function Write-EnsureTrace {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $timestamp = (Get-Date).ToString("o")
  Add-Content -LiteralPath $ensureTraceLog -Value "$timestamp $Message"
}

function Get-EthiopiaNewsWatchHealth {
  try {
    return Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
  } catch {
    return $null
  }
}

function Clear-RunnerLogs {
  foreach ($logPath in @($stdoutLog, $stderrLog)) {
    if (Test-Path $logPath) {
      Remove-Item -LiteralPath $logPath -Force
    }
  }
}

function Test-ProductionBuildIsFresh {
  if (-not (Test-Path $buildIdPath)) {
    return $false
  }

  $buildTimestamp = (Get-Item -LiteralPath $buildIdPath).LastWriteTimeUtc

  foreach ($path in $buildRelevantPaths) {
    if (-not (Test-Path $path)) {
      continue
    }

    $candidate =
      if ((Get-Item -LiteralPath $path) -is [System.IO.DirectoryInfo]) {
        Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTimeUtc -Descending |
          Select-Object -First 1
      } else {
        Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
      }

    if ($candidate -and $candidate.LastWriteTimeUtc -gt $buildTimestamp) {
      return $false
    }
  }

  return $true
}

function Test-EthiopiaNewsWatchReady {
  $health = Get-EthiopiaNewsWatchHealth

  if (-not $health) {
    return $false
  }

  $reportedRoot = [string]$health.projectRoot
  $normalizedReportedRoot =
    if ([string]::IsNullOrWhiteSpace($reportedRoot)) {
      ""
    } else {
      [System.IO.Path]::GetFullPath($reportedRoot).TrimEnd('\').ToLowerInvariant()
    }

  return (
    $health.ok -eq $true -and
    $health.service -eq "ethiopia-news-watch" -and
    $normalizedReportedRoot -eq $expectedProjectRoot -and
    (
      $health.mode -eq "development" -or
      ($health.mode -eq "production" -and (Test-ProductionBuildIsFresh))
    )
  )
}

function Get-ListeningProcessId {
  try {
    return Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    return $null
  }
}

function Stop-ProcessTree {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  $children =
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty ProcessId

  foreach ($childProcessId in $children) {
    Stop-ProcessTree -ProcessId $childProcessId
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Wait-ForPortToClear {
  param(
    [int]$TimeoutSeconds = 20
  )

  for ($attempt = 0; $attempt -lt ($TimeoutSeconds * 4); $attempt += 1) {
    if (-not (Get-ListeningProcessId)) {
      return $true
    }

    Start-Sleep -Milliseconds 250
  }

  return (-not (Get-ListeningProcessId))
}

function Stop-ListeningProcess {
  $listeningPids = @(Get-ListeningProcessId | Select-Object -Unique)

  if (-not $listeningPids) {
    return
  }

  foreach ($listeningPid in $listeningPids) {
    Stop-Process -Id $listeningPid -Force -ErrorAction SilentlyContinue
  }

  if (-not (Wait-ForPortToClear -TimeoutSeconds 4)) {
    foreach ($listeningPid in $listeningPids) {
      Stop-ProcessTree -ProcessId $listeningPid
    }

    Wait-ForPortToClear -TimeoutSeconds 10 | Out-Null
  }

  Write-EnsureTrace "listener:stopped pids=$($listeningPids -join ',')"
}

function Ensure-ExpectedServer {
  $health = Get-EthiopiaNewsWatchHealth

  if (-not $health) {
    if (Get-ListeningProcessId) {
      Stop-ListeningProcess
    }

    Write-EnsureTrace "ensure-server:no-health"
    return $false
  }

  $reportedRoot = [string]$health.projectRoot
  $normalizedReportedRoot =
    if ([string]::IsNullOrWhiteSpace($reportedRoot)) {
      ""
    } else {
      [System.IO.Path]::GetFullPath($reportedRoot).TrimEnd('\').ToLowerInvariant()
    }

  $isExpectedServer =
    $health.ok -eq $true -and
    $health.service -eq "ethiopia-news-watch" -and
    $normalizedReportedRoot -eq $expectedProjectRoot -and
    (
      $health.mode -eq "development" -or
      ($health.mode -eq "production" -and (Test-ProductionBuildIsFresh))
    )

  if (-not $isExpectedServer) {
    Stop-ListeningProcess
    Write-EnsureTrace "ensure-server:rejected mode=$($health.mode)"
    return $false
  }

  Write-EnsureTrace "ensure-server:accepted mode=$($health.mode)"
  return $true
}

function Start-EthiopiaNewsWatchServer {
  $shouldUseProduction = Test-ProductionBuildIsFresh

  Clear-RunnerLogs

  if ($shouldUseProduction) {
    $nodePath = Get-NodePath
    Write-EnsureTrace "server-start:production"
    Start-Process -FilePath $nodePath `
      -ArgumentList @(('"{0}"' -f $nextBin), "start", "--hostname", "127.0.0.1", "--port", "$port") `
      -WorkingDirectory $projectRoot `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -WindowStyle Hidden | Out-Null
    return
  }

  Write-EnsureTrace "server-start:development reason=stale-or-missing-build"
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/c", "npm.cmd run dev -- --hostname 127.0.0.1 --port $port") `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden | Out-Null
}

function Warm-EthiopiaNewsWatchRoutes {
  $warmUrls = @(
    $browserUrl,
    $healthUrl,
    "$browserUrl/api/podcast?scope=weekly",
    "$browserUrl/api/podcast?scope=recent",
    "$browserUrl/api/podcast/archive"
  )

  foreach ($warmUrl in $warmUrls) {
    try {
      Invoke-WebRequest -Uri $warmUrl -UseBasicParsing -TimeoutSec 90 | Out-Null
      Write-EnsureTrace "warm:ok url=$warmUrl"
    } catch {
      Write-EnsureTrace "warm:failed url=$warmUrl error=$($_.Exception.Message)"
    }
  }
}

if (Test-Path $ensureTraceLog) {
  Remove-Item -LiteralPath $ensureTraceLog -Force
}

try {
  Write-EnsureTrace "ensure:start"

  if (-not (Ensure-ExpectedServer)) {
    if (-not (Wait-ForPortToClear)) {
      Stop-ListeningProcess
    }

    if (-not (Wait-ForPortToClear)) {
      throw "Port $port did not clear after stopping the stale server."
    }

    Start-EthiopiaNewsWatchServer
  }

  for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
    if (Test-EthiopiaNewsWatchReady) {
      Write-EnsureTrace "ensure:ready attempt=$attempt"
      Warm-EthiopiaNewsWatchRoutes
      exit 0
    }

    Start-Sleep -Seconds 1
  }

  Write-EnsureTrace "ensure:timeout"
  exit 1
} catch {
  Write-EnsureTrace "ensure:error $($_.Exception.Message)"
  exit 1
}
