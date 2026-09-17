[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'YdgBackup.Common.psm1') -Force

function Get-YdgEncodedStoragePath {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-YdgRelativePath -Path $Path)) { throw 'STORAGE_PATH_UNSAFE' }
  return (($Path.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/')
}

function Invoke-YdgStorageListPage {
  param([Parameter(Mandatory)][string]$Uri, [Parameter(Mandatory)][hashtable]$Headers, [Parameter(Mandatory)][string]$Body)
  for ($attempt = 1; $attempt -le 4; $attempt++) {
    try { return (Invoke-RestMethod -Uri $Uri -Method Post -Headers $Headers -ContentType 'application/json' -Body $Body -TimeoutSec 60) }
    catch {
      $responseProperty = $_.Exception.PSObject.Properties['Response']
      $status = if ($responseProperty -and $responseProperty.Value) { [int]$responseProperty.Value.StatusCode } else { 0 }
      $retryable = $status -eq 0 -or $status -eq 429 -or $status -ge 500
      if ($retryable -and $attempt -lt 4) { Start-Sleep -Seconds 5; continue }
      throw "STORAGE_LIST_HTTP_FAILED:STATUS=$status`:ATTEMPTS=$attempt"
    }
  }
}

function Invoke-YdgStorageDownload {
  param([Parameter(Mandatory)][string]$Uri, [Parameter(Mandatory)][hashtable]$Headers, [Parameter(Mandatory)][string]$Target)
  for ($attempt = 1; $attempt -le 4; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Uri -Method Get -Headers $Headers -OutFile $Target -TimeoutSec 120 | Out-Null
      return
    } catch {
      if (Test-Path -LiteralPath $Target -PathType Leaf) { Remove-Item -LiteralPath $Target }
      $responseProperty = $_.Exception.PSObject.Properties['Response']
      $status = if ($responseProperty -and $responseProperty.Value) { [int]$responseProperty.Value.StatusCode } else { 0 }
      $retryable = $status -eq 0 -or $status -eq 429 -or $status -ge 500
      if ($retryable -and $attempt -lt 4) { Start-Sleep -Seconds 5; continue }
      throw "STORAGE_DOWNLOAD_HTTP_FAILED:STATUS=$status`:ATTEMPTS=$attempt"
    }
  }
}

$config = Get-YdgConfig -ConfigPath $ConfigPath
$mutex = $null
$staging = $null
$serviceRoleKey = $null
$storageHeaders = $null
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

  $serviceRoleKey = Get-YdgCredentialPassword -Target $config.serviceRoleCredentialTarget
  $storageHeaders = @{ apikey = $serviceRoleKey; Authorization = "Bearer $serviceRoleKey" }
  $storageOrigin = "https://$($config.projectRef).supabase.co"

  $current = @()
  foreach ($bucket in $buckets) {
    $prefixQueue = [Collections.Generic.Queue[string]]::new()
    $seenPrefixes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $prefixQueue.Enqueue(''); $bucketCount = 0; $listedRows = 0
    while ($prefixQueue.Count) {
      $prefix = $prefixQueue.Dequeue()
      if (-not $seenPrefixes.Add($prefix)) { continue }
      $offset = 0
      do {
        $body = @{ prefix = $prefix; limit = 1000; offset = $offset; sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json -Compress
        $page = @(Invoke-YdgStorageListPage -Uri "$storageOrigin/storage/v1/object/list/$bucket" -Headers $storageHeaders -Body $body)
        foreach ($row in $page) {
          $nameProperty = $row.PSObject.Properties['name']
          if (-not $nameProperty -or [string]::IsNullOrWhiteSpace([string]$nameProperty.Value)) {
            $propertyNames = (@($row.PSObject.Properties.Name) | Sort-Object) -join ','
            throw "STORAGE_LIST_NAME_MISSING:$bucket`:$propertyNames"
          }
          $name = ([string]$nameProperty.Value).TrimStart('/')
          $path = if ($prefix -and -not $name.StartsWith($prefix, [StringComparison]::Ordinal)) { $prefix + $name } else { $name }
          $metadataProperty = $row.PSObject.Properties['metadata']
          $sizeProperty = if ($metadataProperty -and $metadataProperty.Value) { $metadataProperty.Value.PSObject.Properties['size'] } else { $null }
          if (-not $sizeProperty -or $null -eq $sizeProperty.Value) {
            $folderPath = $path.TrimEnd('/')
            if (-not (Test-YdgRelativePath -Path $folderPath)) { throw "STORAGE_FOLDER_PATH_INVALID:$bucket" }
            $prefixQueue.Enqueue($folderPath + '/')
            continue
          }
          if (-not (Test-YdgRelativePath -Path $path)) { throw "STORAGE_PATH_INVALID:$bucket" }
          $idProperty = $row.PSObject.Properties['id']; $updatedProperty = $row.PSObject.Properties['updated_at']
          $current += [ordered]@{ bucket = $bucket; path = $path; id = if ($idProperty) { [string]$idProperty.Value } else { '' }; updatedAt = if ($updatedProperty) { [string]$updatedProperty.Value } else { '' }; bytes = [long]$sizeProperty.Value; metadataAvailable = $true }
          $bucketCount++
        }
        $listedRows += $page.Count; $offset += $page.Count
        if ($listedRows -gt 100000) { throw "STORAGE_LIST_LIMIT_EXCEEDED:$bucket" }
      } while ($page.Count -eq 1000)
    }
    Write-YdgSafeLog -LogRoot $config.logRoot -Event 'storage_bucket_list_succeeded' -Fields @{ runId = $runId; bucket = $bucket; objects = $bucketCount; folders = $seenPrefixes.Count - 1 }
  }
  if (($current | Group-Object { "$($_.bucket)/$($_.path)" } | Where-Object Count -gt 1)) { throw 'STORAGE_LIST_DUPLICATE_PATH' }

  $previousByPath = @{}
  if ($previous) { foreach ($item in @($previous.objects)) { $previousByPath["$($item.bucket)/$($item.path)"] = $item } }
  $downloaded = @(); $unchanged = @(); $failed = @()
  foreach ($item in $current) {
    $key = "$($item.bucket)/$($item.path)"
    $old = $previousByPath[$key]
    $sameMetadata = $old -and $item.metadataAvailable -eq $true -and [string]$old.id -eq [string]$item.id -and [string]$old.updatedAt -eq [string]$item.updatedAt -and [long]$old.bytes -eq [long]$item.bytes
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
      $encodedPath = Get-YdgEncodedStoragePath -Path ([string]$item.path)
      Invoke-YdgStorageDownload -Uri "$storageOrigin/storage/v1/object/$($item.bucket)/$encodedPath" -Headers $storageHeaders -Target $target
      if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'DOWNLOADED_FILE_MISSING' }
      $local = Get-Item -LiteralPath $target
      if ($item.bytes -ge 0 -and $local.Length -ne $item.bytes) { throw 'DOWNLOADED_FILE_SIZE_MISMATCH' }
      $item['sha256'] = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
      if ($old -and $old.PSObject.Properties['sha256'] -and [string]$old.sha256 -eq [string]$item.sha256) {
        if ($old.PSObject.Properties['setPath']) { $item['setPath'] = [string]$old.setPath }
        $item['sourceRunId'] = if ($old.PSObject.Properties['sourceRunId']) { [string]$old.sourceRunId } else { [string]$previous.runId }
        Remove-Item -LiteralPath $target
        $unchanged += $key
        continue
      }
      $item['setPath'] = [IO.Path]::GetRelativePath($staging, $target).Replace('\','/')
      $item['sourceRunId'] = $runId
      $downloaded += $key
    } catch { $failed += [ordered]@{ key = $key; code = $_.Exception.Message } }
  }
  if ($failed.Count) {
    $failureSummary = @($failed | Group-Object code | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ','
    throw "STORAGE_DOWNLOAD_FAILED:$($failed.Count):$failureSummary"
  }

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
  $storageHeaders = $null
  $serviceRoleKey = $null
  if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}
