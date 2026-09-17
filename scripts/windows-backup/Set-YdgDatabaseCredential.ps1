[CmdletBinding(SupportsShouldProcess)]
param([string]$Target = 'YDG/Supabase/DatabasePassword')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not ('YdgCredentialWriter' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class YdgCredentialWriter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  public static void Write(string target, string user, string password) {
    IntPtr blob=Marshal.StringToCoTaskMemUni(password);
    try { var c=new CREDENTIAL { Type=1, TargetName=target, UserName=user, CredentialBlob=blob, CredentialBlobSize=(UInt32)(password.Length*2), Persist=2, Comment="YDG Supabase database backup only" }; if(!CredWrite(ref c,0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    finally { Marshal.ZeroFreeCoTaskMemUnicode(blob); }
  }
}
'@
}
$credential = Get-Credential -Message 'Enter the Supabase database password. It will be stored only in Windows Credential Manager.'
$plain = [Net.NetworkCredential]::new('', $credential.Password).Password
try {
  if ($PSCmdlet.ShouldProcess($Target, 'Store database password in Windows Credential Manager')) { [YdgCredentialWriter]::Write($Target, $credential.UserName, $plain) }
} finally { $plain = $null }
