[CmdletBinding()]
param([Parameter(Mandatory)][string]$Path)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'BACKUP_SET_NOT_FOUND' }
if (-not (Test-Path -LiteralPath (Join-Path $Path 'BACKUP_COMPLETE') -PathType Leaf)) { throw 'BACKUP_SET_INCOMPLETE' }
$manifestPath = Join-Path $Path 'manifest.json'
$sumsPath = Join-Path $Path 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $sumsPath -PathType Leaf)) { throw 'BACKUP_METADATA_MISSING' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.complete -ne $true) { throw 'BACKUP_MANIFEST_INCOMPLETE' }
$checked = 0
foreach ($line in Get-Content -LiteralPath $sumsPath) {
  if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw 'CHECKSUM_FILE_INVALID' }
  $relative = $Matches[2]
  if ([IO.Path]::IsPathFullyQualified($relative) -or $relative -match '(^|/)\.\.(/|$)') { throw 'CHECKSUM_PATH_UNSAFE' }
  $file = Join-Path $Path $relative.Replace('/','\')
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "CHECKSUM_FILE_MISSING:$relative" }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() -ne $Matches[1]) { throw "CHECKSUM_MISMATCH:$relative" }
  $checked++
}
if ($checked -lt 1) { throw 'CHECKSUM_FILE_EMPTY' }
if ($manifest.formatVersion -eq 'ydg-windows-database-backup-v1') {
  foreach ($name in 'roles.sql','schema.sql','data.sql') { if (-not (Test-Path -LiteralPath (Join-Path $Path $name))) { throw "DATABASE_DUMP_MISSING:$name" } }
} elseif ($manifest.formatVersion -ne 'ydg-windows-storage-backup-v1') { throw 'BACKUP_FORMAT_UNKNOWN' }
[pscustomobject]@{ valid = $true; formatVersion = $manifest.formatVersion; runId = $manifest.runId; checkedFiles = $checked; restoreExecuted = $false }
