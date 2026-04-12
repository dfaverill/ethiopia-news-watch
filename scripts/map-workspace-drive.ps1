param(
  [ValidatePattern("^[A-Za-z]$")]
  [string]$DriveLetter = "W",

  [string]$TargetPath,

  [switch]$Force
)

function Normalize-Path {
  param([Parameter(Mandatory = $true)][string]$PathValue)

  return [System.IO.Path]::GetFullPath($PathValue).TrimEnd("\")
}

function Get-SubstMappings {
  $mappings = @{}

  foreach ($line in (cmd.exe /c subst)) {
    if ($line -match "^([A-Z]:)\\: => (.+)$") {
      $mappings[$matches[1]] = $matches[2].Trim()
    }
  }

  return $mappings
}

if (-not $TargetPath) {
  $TargetPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$canonicalTarget = Normalize-Path -PathValue $TargetPath

if (-not (Test-Path -LiteralPath $canonicalTarget)) {
  throw "Target path does not exist: $canonicalTarget"
}

$driveRoot = "$($DriveLetter.ToUpper()):"
$physicalDrive = Get-PSDrive -Name $DriveLetter -PSProvider FileSystem -ErrorAction SilentlyContinue
$substMappings = Get-SubstMappings

if ($physicalDrive -and -not $substMappings.ContainsKey($driveRoot)) {
  throw "Drive letter $driveRoot is already in use by a physical or network drive."
}

if ($substMappings.ContainsKey($driveRoot)) {
  $existingTarget = Normalize-Path -PathValue $substMappings[$driveRoot]

  if ($existingTarget -eq $canonicalTarget) {
    Write-Host "Drive already maps to target: $driveRoot -> $canonicalTarget"
    exit 0
  }

  if (-not $Force) {
    throw "Drive $driveRoot already maps to $existingTarget. Re-run with -Force to replace it."
  }

  cmd.exe /c "subst $driveRoot /D" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to remove existing mapping for $driveRoot"
  }
}

cmd.exe /c "subst $driveRoot `"$canonicalTarget`"" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create drive mapping: $driveRoot -> $canonicalTarget"
}

Write-Host "Mapped drive: $driveRoot -> $canonicalTarget"
