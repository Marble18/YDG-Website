[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][string]$ConfigPath,
  [string]$DailyTime = '20:00',
  [ValidateSet('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')][string]$WeeklyDay = 'Sunday',
  [string]$WeeklyTime = '20:30'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'YdgBackup.Common.psm1') -Force
$config = Get-YdgConfig -ConfigPath $ConfigPath
if (-not (Test-Path -LiteralPath $config.destinationRoot -PathType Container)) { throw 'DESTINATION_ROOT_NOT_FOUND' }
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30) -ExecutionTimeLimit (New-TimeSpan -Hours 8)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$dailyAction = New-ScheduledTaskAction -Execute $pwsh -Argument ('-NoLogo -NoProfile -NonInteractive -File "{0}" -ConfigPath "{1}"' -f (Join-Path $PSScriptRoot 'Invoke-YdgDatabaseBackup.ps1'), $ConfigPath)
$weeklyAction = New-ScheduledTaskAction -Execute $pwsh -Argument ('-NoLogo -NoProfile -NonInteractive -File "{0}" -ConfigPath "{1}"' -f (Join-Path $PSScriptRoot 'Invoke-YdgStorageBackup.ps1'), $ConfigPath)
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyTime
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $WeeklyDay -At $WeeklyTime
if ($PSCmdlet.ShouldProcess('Windows Task Scheduler', 'Register YDG Database Daily and YDG Storage Weekly tasks')) {
  Register-ScheduledTask -TaskName 'YDG Database Daily Backup' -Action $dailyAction -Trigger $dailyTrigger -Settings $settings -Principal $principal -Description 'Read-only Supabase logical database backup to Google Drive.' -Force | Out-Null
  Register-ScheduledTask -TaskName 'YDG Storage Weekly Backup' -Action $weeklyAction -Trigger $weeklyTrigger -Settings $settings -Principal $principal -Description 'Read-only incremental Supabase product image backup to Google Drive.' -Force | Out-Null
}
