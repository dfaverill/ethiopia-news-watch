param(
  [Parameter(Mandatory = $true)]
  [string[]]$AliasPath,

  [string]$TargetPath,

  [switch]$DryRun
)

function Normalize-Path {
  param([Parameter(Mandatory = $true)][string]$PathValue)

  return [System.IO.Path]::GetFullPath($PathValue).TrimEnd("\")
}

function Get-BackupPath {
  param([Parameter(Mandatory = $true)][string]$PathValue)

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $candidate = "$PathValue.backup-$timestamp"
  $suffix = 1

  while (Test-Path -LiteralPath $candidate) {
    $candidate = "$PathValue.backup-$timestamp-$suffix"
    $suffix += 1
  }

  return $candidate
}

if (-not $TargetPath) {
  $TargetPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$canonicalTarget = Normalize-Path -PathValue $TargetPath

if (-not (Test-Path -LiteralPath $canonicalTarget)) {
  throw "Target path does not exist: $canonicalTarget"
}

$targetDrive = Split-Path -Path $canonicalTarget -Qualifier
$volume = Get-Volume -DriveLetter $targetDrive.TrimEnd(":") -ErrorAction SilentlyContinue

if ($volume -and $volume.FileSystem -ne "NTFS" -and $volume.FileSystem -ne "ReFS") {
  throw "Junction-based aliases are not supported on $($volume.FileSystem). Use scripts\\map-workspace-drive.ps1 instead."
}

foreach ($alias in $AliasPath) {
  $canonicalAlias = Normalize-Path -PathValue $alias

  if ($canonicalAlias -eq $canonicalTarget) {
    Write-Host "Skipping $canonicalAlias because it is already the target path."
    continue
  }

  $parent = Split-Path -Path $canonicalAlias -Parent
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    if ($DryRun) {
      Write-Host "[dry-run] Create parent directory: $parent"
    } else {
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
  }

  $existing = Get-Item -LiteralPath $canonicalAlias -Force -ErrorAction SilentlyContinue

  if ($existing) {
    $isJunction = ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -and $existing.LinkType -eq "Junction"
    $existingTarget = $null

    if ($isJunction -and $existing.Target) {
      $existingTarget = Normalize-Path -PathValue $existing.Target
    }

    if ($existingTarget -eq $canonicalTarget) {
      Write-Host "Alias already points to target: $canonicalAlias -> $canonicalTarget"
      continue
    }

    $backupPath = Get-BackupPath -PathValue $canonicalAlias

    if ($DryRun) {
      Write-Host "[dry-run] Move existing path to backup: $canonicalAlias -> $backupPath"
    } else {
      Move-Item -LiteralPath $canonicalAlias -Destination $backupPath
      Write-Host "Backed up existing path: $canonicalAlias -> $backupPath"
    }
  }

  if ($DryRun) {
    Write-Host "[dry-run] Create junction: $canonicalAlias -> $canonicalTarget"
    continue
  }

  $mklinkOutput = cmd.exe /c "mklink /J `"$canonicalAlias`" `"$canonicalTarget`""
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create junction: $mklinkOutput"
  }

  Write-Host "Created junction: $canonicalAlias -> $canonicalTarget"
}
