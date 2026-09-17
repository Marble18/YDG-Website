[CmdletBinding(SupportsShouldProcess)]
param([string]$Target = 'YDG/Supabase/ServiceRoleKey')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not ('YdgServiceRoleCredentialWriter' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class YdgServiceRoleCredentialWriter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  public static void Write(string target, string user, string password) {
    IntPtr blob=Marshal.StringToCoTaskMemUni(password);
    try { var c=new CREDENTIAL { Type=1, TargetName=target, UserName=user, CredentialBlob=blob, CredentialBlobSize=(UInt32)(password.Length*2), Persist=2, Comment="YDG Supabase Storage read-only backup transport" }; if(!CredWrite(ref c,0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    finally { Marshal.ZeroFreeCoTaskMemUnicode(blob); }
  }
}
'@
}
$credential = Get-Credential -UserName 'service_role' -Message 'Enter the Supabase service_role key. It will be stored only in Windows Credential Manager.'
$plain = [Net.NetworkCredential]::new('', $credential.Password).Password
try {
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'SERVICE_ROLE_CREDENTIAL_EMPTY' }
  if ($PSCmdlet.ShouldProcess($Target, 'Store service-role key in Windows Credential Manager')) { [YdgServiceRoleCredentialWriter]::Write($Target, $credential.UserName, $plain) }
} finally { $plain = $null }
