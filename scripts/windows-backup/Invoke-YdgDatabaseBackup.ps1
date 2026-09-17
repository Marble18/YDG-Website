[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'YdgBackup.Common.psm1') -Force

$config = Get-YdgConfig -ConfigPath $ConfigPath
$mutex = $null
$staging = $null
$previousPassword = $env:SUPABASE_DB_PASSWORD
try {
  $mutex = Enter-YdgBackupLock
  $runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
  $staging = Join-Path ([string]$config.tempRoot) ('database-' + $runId)
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  Write-YdgSafeLog -LogRoot $config.logRoot -Event 'database_backup_started' -Fields @{ runId = $runId; projectRef = $config.projectRef }

  $env:SUPABASE_DB_PASSWORD = Get-YdgCredentialPassword -Target $config.credentialTarget
  $common = @('--linked','--project-ref',[string]$config.projectRef)
  [void](Invoke-YdgCli -Cli $config.supabaseCli -WorkingDirectory $PSScriptRoot -Arguments (@('db','dump') + $common + @('--role-only','--file',(Join-Path $staging 'roles.sql'))))
  [void](Invoke-YdgCli -Cli $config.supabaseCli -WorkingDirectory $PSScriptRoot -Arguments (@('db','dump') + $common + @('--file',(Join-Path $staging 'schema.sql'))))
  [void](Invoke-YdgCli -Cli $config.supabaseCli -WorkingDirectory $PSScriptRoot -Arguments (@('db','dump') + $common + @('--data-only','--use-copy','--file',(Join-Path $staging 'data.sql'))))

  $minimum = @{ 'roles.sql' = 1; 'schema.sql' = 100; 'data.sql' = 100 }
  foreach ($name in $minimum.Keys) {
    $file = Get-Item -LiteralPath (Join-Path $staging $name)
    if ($file.Length -lt $minimum[$name]) { throw "DUMP_FILE_INVALID:$name" }
  }

  $countSql = Join-Path $staging 'counts.sql'
  $tables = 'categories','products','profiles','orders','order_items','cart_items','inventory_movements','voucher_settings','app_settings','delivery_proofs'
  $selects = $tables | ForEach-Object { "select '$_' as source, count(*)::bigint as records from public.$_" }
  $selects += "select 'storage.product-images', count(*)::bigint from storage.objects where bucket_id='product-images'"
  $selects += "select 'storage.delivery-proofs', count(*)::bigint from storage.objects where bucket_id='delivery-proofs'"
  Set-Content -LiteralPath $countSql -Value (($selects -join "`nunion all`n") + ';') -Encoding utf8NoBOM
  $countOutput = Invoke-YdgCli -Cli $config.supabaseCli -WorkingDirectory $PSScriptRoot -Arguments @('db','query','--linked','--project-ref',[string]$config.projectRef,'--file',$countSql,'--output','json')
  $jsonStart = $countOutput.IndexOf('{'); $jsonEnd = $countOutput.LastIndexOf('}')
  if ($jsonStart -lt 0 -or $jsonEnd -le $jsonStart) { throw 'COUNT_QUERY_INVALID' }
  $countEnvelope = $countOutput.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json
  $counts = [ordered]@{}
  foreach ($row in $countEnvelope.rows) { $counts[[string]$row.source] = [long]$row.records }
  if ($counts.Count -ne 12) { throw 'COUNT_QUERY_INCOMPLETE' }
  Remove-Item -LiteralPath $countSql

  $dumpFiles = 'roles.sql','schema.sql','data.sql' | ForEach-Object { Get-YdgFileHashRecord -Root $staging -Path (Join-Path $staging $_) }
  $manifest = [ordered]@{
    formatVersion = 'ydg-windows-database-backup-v1'; complete = $false; projectRef = $config.projectRef
    createdAt = (Get-Date).ToUniversalTime().ToString('o'); runId = $runId; tableCounts = $counts
    files = $dumpFiles; excludes = @('Auth passwords and hashes','Storage object bytes','secret keys','tokens')
  }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding utf8NoBOM
  $hashFiles = 'roles.sql','schema.sql','data.sql','manifest.json' | ForEach-Object { Get-YdgFileHashRecord -Root $staging -Path (Join-Path $staging $_) }
  ($hashFiles | ForEach-Object { "$($_.sha256)  $($_.path)" }) | Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding ascii

  $destinationParent = Join-Path ([string]$config.destinationRoot) 'database'
  if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) { throw 'DATABASE_DESTINATION_NOT_FOUND' }
  $final = Complete-YdgBackupSet -StagingPath $staging -DestinationParent $destinationParent -FinalName $runId
  Write-YdgSafeLog -LogRoot $config.logRoot -Event 'database_backup_succeeded' -Fields @{ runId = $runId; files = 5; tables = $counts.Count; destination = $final }
  Write-Output ([pscustomobject]@{ success = $true; runId = $runId; destination = $final; tableCounts = $counts })
} catch {
  Write-YdgSafeLog -LogRoot $config.logRoot -Event 'database_backup_failed' -Level ERROR -Fields @{ code = $_.Exception.Message; stagingRetained = [bool]$staging }
  throw
} finally {
  if ($null -eq $previousPassword) { Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue } else { $env:SUPABASE_DB_PASSWORD = $previousPassword }
  if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}
