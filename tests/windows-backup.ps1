Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$scripts = Join-Path $repo 'scripts\windows-backup'
$errors = @()
Get-ChildItem -LiteralPath $scripts -Filter '*.ps1' | ForEach-Object {
  $tokens = $null; $parseErrors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { $errors += $parseErrors }
}
if ($errors.Count) { throw ('POWERSHELL_PARSE_FAILED: ' + ($errors.Message -join '; ')) }

Import-Module (Join-Path $scripts 'YdgBackup.Common.psm1') -Force
if (-not (Test-YdgRelativePath 'folder/photo.webp')) { throw 'SAFE_PATH_REJECTED' }
foreach ($unsafe in '../photo.png','/photo.png','folder\photo.png','folder//photo.png') { if (Test-YdgRelativePath $unsafe) { throw "UNSAFE_PATH_ACCEPTED:$unsafe" } }
$storageFixture = @(
  @{ name = 'nested/b.webp'; id = '2'; updated_at = '2026-09-17T00:00:00Z'; metadata = @{ size = 20 } },
  @{ name = 'a.png'; id = '1'; updated_at = '2026-09-16T00:00:00Z'; metadata = @{ size = 10 } }
) | ConvertTo-Json -Depth 5 -Compress
$parsedStorage = @(ConvertFrom-YdgStorageList -Output ("CLI notice`n" + $storageFixture) -Bucket 'product-images')
if ($parsedStorage.Count -ne 2 -or $parsedStorage[0].path -ne 'a.png' -or $parsedStorage[1].bytes -ne 20) { throw 'STORAGE_LIST_PARSE_FAILED' }

$root = Join-Path ([IO.Path]::GetTempPath()) ('ydg-backup-test-' + [guid]::NewGuid().ToString('N'))
$staging = Join-Path $root 'staging'; $destination = Join-Path $root 'destination'; $logs = Join-Path $root 'logs'
try {
  New-Item -ItemType Directory -Force -Path $staging,$destination | Out-Null
  Set-Content -LiteralPath (Join-Path $staging 'sample.txt') -Value 'fixture' -Encoding utf8NoBOM
  @{ formatVersion = 'ydg-windows-storage-backup-v1'; complete = $false; runId = 'fixture-run' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding utf8NoBOM
  $initialFiles = Get-ChildItem -LiteralPath $staging -File | Sort-Object FullName | ForEach-Object { Get-YdgFileHashRecord -Root $staging -Path $_.FullName }
  ($initialFiles | ForEach-Object { "$($_.sha256)  $($_.path)" }) | Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding ascii
  $final = Complete-YdgBackupSet -StagingPath $staging -DestinationParent $destination -FinalName 'fixture-run'
  if (-not (Test-Path -LiteralPath (Join-Path $final 'BACKUP_COMPLETE'))) { throw 'COMPLETE_MARKER_MISSING' }
  if ((Get-Content -LiteralPath (Join-Path $final 'manifest.json') -Raw | ConvertFrom-Json).complete -ne $true) { throw 'FINAL_MANIFEST_NOT_COMPLETE' }
  if ((Get-Content -LiteralPath (Join-Path $final 'sample.txt') -Raw).Trim() -ne 'fixture') { throw 'COPIED_CONTENT_INVALID' }
  $validated = & (Join-Path $scripts 'Test-YdgBackupSet.ps1') -Path $final
  if ($validated.valid -ne $true -or $validated.restoreExecuted -ne $false) { throw 'OFFLINE_VALIDATION_FAILED' }
  Write-YdgSafeLog -LogRoot $logs -Event 'fixture' -Fields @{ password = 'must-not-appear'; token = 'must-not-appear'; count = 3 }
  $log = Get-Content -LiteralPath (Get-ChildItem -LiteralPath $logs -File | Select-Object -First 1) -Raw
  if ($log -match 'must-not-appear' -or $log -notmatch '"count":3') { throw 'SAFE_LOG_REDACTION_FAILED' }
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}

$app = Get-Content -LiteralPath (Join-Path $repo 'app.js') -Raw
$index = Get-Content -LiteralPath (Join-Path $repo 'index.html') -Raw
foreach ($retired in 'download-backup','download-storage-archive','restore-backup','restore-storage-archive','createBusinessBackupService') {
  if ($app.Contains($retired) -or $index.Contains($retired)) { throw "DASHBOARD_BACKUP_NOT_RETIRED:$retired" }
}
Write-Output 'PASS: PowerShell syntax, path safety, verified destination copy, complete marker, safe log redaction, and dashboard backup retirement.'
