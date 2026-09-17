Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-YdgSafeLog {
  param([string]$LogRoot, [string]$Event, [ValidateSet('INFO','ERROR')][string]$Level = 'INFO', [hashtable]$Fields = @{})
  New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
  $safe = [ordered]@{ timestamp = (Get-Date).ToUniversalTime().ToString('o'); level = $Level; event = $Event }
  foreach ($key in $Fields.Keys) {
    if ($key -match '(?i)secret|token|password|content|sql|authorization') { continue }
    $value = $Fields[$key]
    if ($value -is [string] -and $value.Length -gt 200) { $value = $value.Substring(0, 200) }
    $safe[$key] = $value
  }
  Add-Content -LiteralPath (Join-Path $LogRoot ('backup-' + (Get-Date -Format 'yyyy-MM') + '.jsonl')) -Value ($safe | ConvertTo-Json -Compress)
}

function Get-YdgConfig {
  param([Parameter(Mandatory)][string]$ConfigPath)
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'CONFIG_NOT_FOUND' }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  foreach ($name in 'projectRef','destinationRoot','tempRoot','logRoot','supabaseCli','credentialTarget') {
    if ([string]::IsNullOrWhiteSpace([string]$config.$name)) { throw "CONFIG_VALUE_MISSING:$name" }
  }
  if ($config.projectRef -notmatch '^[a-z]{20}$') { throw 'PROJECT_REF_INVALID' }
  if (-not [IO.Path]::IsPathFullyQualified([string]$config.destinationRoot)) { throw 'DESTINATION_MUST_BE_ABSOLUTE' }
  if (-not [IO.Path]::IsPathFullyQualified([string]$config.tempRoot)) { throw 'TEMP_ROOT_MUST_BE_ABSOLUTE' }
  return $config
}

function Get-YdgCredentialPassword {
  param([Parameter(Mandatory)][string]$Target)
  if (-not ('YdgNativeCredential' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class YdgNativeCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr buffer);
  public static string ReadPassword(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Credential Manager entry was not found");
    try { var cred=(CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL)); return cred.CredentialBlobSize == 0 ? "" : Marshal.PtrToStringUni(cred.CredentialBlob, (int)cred.CredentialBlobSize/2); }
    finally { CredFree(ptr); }
  }
}
'@
  }
  $password = [YdgNativeCredential]::ReadPassword($Target)
  if ([string]::IsNullOrEmpty($password)) { throw 'DATABASE_CREDENTIAL_EMPTY' }
  return $password
}

function Invoke-YdgCli {
  param([Parameter(Mandatory)][string]$Cli, [Parameter(Mandatory)][string[]]$Arguments, [string]$WorkingDirectory)
  if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) { throw 'SUPABASE_CLI_NOT_FOUND' }
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $Cli
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  foreach ($argument in $Arguments) { [void]$psi.ArgumentList.Add($argument) }
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi
  [void]$process.Start()
  # Drain both redirected streams concurrently. Supabase/Docker can emit enough
  # progress output on stderr to fill the pipe while stdout is still open.
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) {
    $safeError = [string]$stderr
    $safeError = $safeError -replace 'eyJ[A-Za-z0-9_.-]+', '[REDACTED_TOKEN]'
    $safeError = $safeError -replace 'https?://\S+', '[REDACTED_URL]'
    $safeError = $safeError -replace '(?i)(access[_ -]?token|authorization|password)\s*[:=]\s*\S+', '$1=[REDACTED]'
    $safeError = $safeError -replace 'ss:///\S+', '[STORAGE_PATH]'
    $safeError = $safeError -replace '(?i)[A-Z]:\\[^\r\n]+', '[LOCAL_PATH]'
    $safeLines = @($safeError -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 3)
    $safeSummary = if ($safeLines.Count) { ($safeLines | ForEach-Object { $_.Trim() }) -join ' | ' } else { 'No safe CLI error detail was returned.' }
    if ($safeSummary.Length -gt 500) { $safeSummary = $safeSummary.Substring(0, 500) }
    throw "SUPABASE_CLI_FAILED:$($process.ExitCode):$safeSummary"
  }
  return $stdout
}

function Get-YdgFileHashRecord {
  param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Path)
  $item = Get-Item -LiteralPath $Path
  $relative = [IO.Path]::GetRelativePath($Root, $item.FullName).Replace('\','/')
  return [ordered]@{ path = $relative; bytes = $item.Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant() }
}

function Test-YdgRelativePath {
  param([Parameter(Mandatory)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path) -or $Path.StartsWith('/') -or $Path.Contains('\')) { return $false }
  $parts = $Path.Split('/')
  $invalid = @($parts | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })
  return $invalid.Count -eq 0
}

function ConvertFrom-YdgStorageList {
  param([Parameter(Mandatory)][string]$Output, [Parameter(Mandatory)][string]$Bucket)
  function Value($object, [string[]]$names, $fallback = $null) {
    foreach ($name in $names) { $property = $object.PSObject.Properties[$name]; if ($property -and $null -ne $property.Value) { return $property.Value } }
    return $fallback
  }
  $start = $Output.IndexOf('['); $end = $Output.LastIndexOf(']')
  if ($start -lt 0 -or $end -le $start) { throw "STORAGE_LIST_INVALID:$Bucket" }
  $rows = @($Output.Substring($start, $end - $start + 1) | ConvertFrom-Json)
  $result = foreach ($row in $rows) {
    $path = [string](Value $row @('name','Name','key','Key') '')
    if ($path.StartsWith($Bucket + '/')) { $path = $path.Substring($Bucket.Length + 1) }
    if (-not (Test-YdgRelativePath -Path $path)) { throw "STORAGE_PATH_INVALID:$Bucket" }
    $metadata = Value $row @('metadata') $null
    $sizeValue = Value $row @('size') $null
    if ($null -eq $sizeValue -and $null -ne $metadata) { $sizeValue = Value $metadata @('size') -1 }
    if ($null -eq $sizeValue) { $sizeValue = -1 }
    [ordered]@{
      bucket = $Bucket; path = $path; id = [string](Value $row @('id') '')
      updatedAt = [string](Value $row @('updated_at','updatedAt') '')
      bytes = [long]$sizeValue
    }
  }
  return @($result | Sort-Object { $_['bucket'] }, { $_['path'] })
}

function Complete-YdgBackupSet {
  param([Parameter(Mandatory)][string]$StagingPath, [Parameter(Mandatory)][string]$DestinationParent, [Parameter(Mandatory)][string]$FinalName)
  if (-not (Test-Path -LiteralPath $DestinationParent -PathType Container)) { throw 'DESTINATION_ROOT_NOT_FOUND' }
  $incoming = Join-Path $DestinationParent ('.incoming-' + [guid]::NewGuid().ToString('N'))
  $final = Join-Path $DestinationParent $FinalName
  if (Test-Path -LiteralPath $final) { throw 'FINAL_BACKUP_ALREADY_EXISTS' }
  Copy-Item -LiteralPath $StagingPath -Destination $incoming -Recurse
  $sourceFiles = Get-ChildItem -LiteralPath $StagingPath -File -Recurse | Sort-Object FullName | ForEach-Object { Get-YdgFileHashRecord -Root $StagingPath -Path $_.FullName }
  $destinationFiles = Get-ChildItem -LiteralPath $incoming -File -Recurse | Sort-Object FullName | ForEach-Object { Get-YdgFileHashRecord -Root $incoming -Path $_.FullName }
  if (($sourceFiles | ConvertTo-Json -Compress) -ne ($destinationFiles | ConvertTo-Json -Compress)) { throw 'DESTINATION_CHECKSUM_MISMATCH' }
  $manifestPath = Join-Path $incoming 'manifest.json'
  $sumsPath = Join-Path $incoming 'SHA256SUMS.txt'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'DESTINATION_MANIFEST_MISSING' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifest.complete = $true
  $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
  $finalHashFiles = Get-ChildItem -LiteralPath $incoming -File -Recurse | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object FullName | ForEach-Object { Get-YdgFileHashRecord -Root $incoming -Path $_.FullName }
  ($finalHashFiles | ForEach-Object { "$($_.sha256)  $($_.path)" }) | Set-Content -LiteralPath $sumsPath -Encoding ascii
  Set-Content -LiteralPath (Join-Path $incoming 'BACKUP_COMPLETE') -Value ((Get-Date).ToUniversalTime().ToString('o')) -Encoding utf8NoBOM
  Rename-Item -LiteralPath $incoming -NewName $FinalName
  return $final
}

function Enter-YdgBackupLock {
  param([string]$Name = 'Global\YDG-Supabase-Backup')
  $mutex = [Threading.Mutex]::new($false, $Name)
  if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); throw 'BACKUP_ALREADY_RUNNING' }
  return $mutex
}

Export-ModuleMember -Function Write-YdgSafeLog,Get-YdgConfig,Get-YdgCredentialPassword,Invoke-YdgCli,Get-YdgFileHashRecord,Test-YdgRelativePath,ConvertFrom-YdgStorageList,Complete-YdgBackupSet,Enter-YdgBackupLock
