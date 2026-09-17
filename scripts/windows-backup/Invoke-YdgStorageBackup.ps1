[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'YdgBackup.Common.psm1') -Force

$config = Get-YdgConfig -ConfigPath $ConfigPath
$mutex = $null
$staging = $null
try {
  $mutex = Enter-YdgBackupLock
  $runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
  $staging = Join-Path ([string]$config.tempRoot) ('storage-' + $runId)
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  $manifestRoot = Join-Path ([string]$config.destinationRoot) 'storage\manifests'
  $setRoot = Join-Path ([string]$config.destinationRoot) 'storage\sets'
  if (-not (Test-Path -LiteralPath $manifestRoot -PathType Container) -or -not (Test-Path -LiteralPath $setRoot -PathType Container)) { throw 'STORAGE_DESTINATION_NOT_FOUND' }
  $latestPath = Join-Path $manifestRoot 'latest.json'
  $isInitial = -not (Test-Path -LiteralPath $latestPath -PathType Leaf)
  $previous = if ($isInitial) { $null } else { Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json }
  if ($previous -and $previous.complete -ne $true) { throw 'PREVIOUS_STORAGE_MANIFEST_INCOMPLETE' }
  $buckets = if ($isInitial) { @('product-images','delivery-proofs') } else { @('product-images') }
  Write-YdgSafeLog -LogRoot $config.logRoot -Event 'storage_backup_started' -Fields @{ runId = $runId; initialFull = $isInitial; buckets = ($buckets -join ',') }

  $current = @()
  foreach ($bucket in $buckets) {
    $output = Invoke-YdgCli -Cli $config.supabaseCli -WorkingDirectory $PSScriptRoot -Arguments @('storage','ls',"ss:///$bucket",'--recursive','--linked','--project-ref',[string]$config.projectRef,'--output','json')
    $current += ConvertFrom-YdgStorageList -Output $output -Bucket $bucket
  }
  if (($current | Group-Object { "$($_.bucket)/$($_.path)" } | Where-Object Count -gt 1)) { throw 'STORAGE_LIST_DUPLICATE_PATH' }

  $previousByPath = @{}
  if ($previous) { foreach ($item in @($previous.objects)) { $previousByPath["$($item.bucket)/$($item.path)"] = $item } }
  $downloaded = @(); $unchanged = @(); $failed = @()
  foreach ($item in $current) {
    $key = "$($item.bucket)/$($item.path)"
    $old = $previousByPath[$key]
    $sameMetadata = $old -and [string]$old.id -eq [string]$item.id -and [string]$old.updatedAt -eq [string]$item.updatedAt -and [long]$old.bytes -eq [long]$item.bytes
    if ($sameMetadata) {
      if ($old.PSObject.Properties['sha256']) { $item['sha256'] = [string]$old.sha256 }
      if ($old.PSObject.Properties['setPath']) { $item['setPath'] = [string]$old.setPath }
      $item['sourceRunId'] = if ($old.PSObject.Properties['sourceRunId']) { [string]$old.sourceRunId } else { [string]$previous.runId }
      $unchanged += $key
      continue
    }
    $target = Join-Path $staging ('objects\' + $item.bucket + '\' + $item.path.Replace('/','\'))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    try {
      [void](Invoke-YdgCli -Cli $config.supabaseCli -WorkingDirectory $PSScriptRoot -Arguments @('storage','cp',"ss:///$key",$target,'--linked','--project-ref',[string]$config.projectRef))
      if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'DOWNLOADED_FILE_MISSING' }
      $local = Get-Item -LiteralPath $target
      if ($item.bytes -ge 0 -and $local.Length -ne $item.bytes) { throw 'DOWNLOADED_FILE_SIZE_MISMATCH' }
      $item['sha256'] = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
      $item['setPath'] = [IO.Path]::GetRelativePath($staging, $target).Replace('\','/')
      $item['sourceRunId'] = $runId
      $downloaded += $key
    } catch { $failed += [ordered]@{ key = $key; code = $_.Exception.Message } }
  }
  if ($failed.Count) { throw "STORAGE_DOWNLOAD_FAILED:$($failed.Count)" }

  $currentKeys = @{}; foreach ($item in $current) { $currentKeys["$($item.bucket)/$($item.path)"] = $true }
  $deleted = @()
  if ($previous) {
    foreach ($item in @($previous.objects | Where-Object bucket -eq 'product-images')) {
      $key = "$($item.bucket)/$($item.path)"; if (-not $currentKeys.ContainsKey($key)) { $deleted += $key }
    }
  }
  $manifest = [ordered]@{
    formatVersion = 'ydg-windows-storage-backup-v1'; complete = $false; projectRef = $config.projectRef
    createdAt = (Get-Date).ToUniversalTime().ToString('o'); runId = $runId; initialFull = $isInitial
    buckets = $buckets; objects = $current; downloaded = $downloaded; unchanged = $unchanged; deleted = $deleted
    previousRunId = if ($previous) { $previous.runId } else { $null }
  }
  $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding utf8NoBOM
  $files = Get-ChildItem -LiteralPath $staging -File -Recurse | Sort-Object FullName | ForEach-Object { Get-YdgFileHashRecord -Root $staging -Path $_.FullName }
  ($files | ForEach-Object { "$($_.sha256)  $($_.path)" }) | Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding ascii
  $final = Complete-YdgBackupSet -StagingPath $staging -DestinationParent $setRoot -FinalName $runId

  $latestIncoming = Join-Path $manifestRoot ('.incoming-' + [guid]::NewGuid().ToString('N') + '.json')
  Copy-Item -LiteralPath (Join-Path $final 'manifest.json') -Destination $latestIncoming
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $latestIncoming).Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $final 'manifest.json')).Hash) { throw 'LATEST_MANIFEST_COPY_FAILED' }
  Move-Item -LiteralPath $latestIncoming -Destination $latestPath -Force
  Write-YdgSafeLog -LogRoot $config.logRoot -Event 'storage_backup_succeeded' -Fields @{ runId = $runId; initialFull = $isInitial; total = $current.Count; downloaded = $downloaded.Count; unchanged = $unchanged.Count; deleted = $deleted.Count; destination = $final }
  Write-Output ([pscustomobject]@{ success = $true; runId = $runId; destination = $final; initialFull = $isInitial; total = $current.Count; downloaded = $downloaded.Count; unchanged = $unchanged.Count; deleted = $deleted.Count })
} catch {
  Write-YdgSafeLog -LogRoot $config.logRoot -Event 'storage_backup_failed' -Level ERROR -Fields @{ code = $_.Exception.Message; stagingRetained = [bool]$staging }
  throw
} finally {
  if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}
