param([int]$Port = 9335, [switch]$FunctionsOnly)
$ErrorActionPreference = 'Stop'

function Assert-IntroListenerOwner {
  param([object[]]$Listeners, $Identity, [int]$SessionId)
  if (-not $Listeners.Count) { throw 'CDP listener unavailable.' }
  if (@($Listeners | Where-Object { $_.Address -notin @('127.0.0.1','[::1]') }).Count) { throw 'CDP must listen only on loopback.' }
  $owners = @($Listeners | Select-Object -ExpandProperty ProcessId -Unique)
  if ($owners.Count -ne 1) { throw 'CDP has ambiguous process owners.' }
  $programRoot = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
  $official = '^' + [regex]::Escape((Join-Path $programRoot 'WindowsApps')) + '\\OpenAI\.Codex_\d+\.\d+\.\d+\.\d+_(?:x64|arm64|x86)__2p2nqsd0c76g0\\app\\ChatGPT\.exe$'
  if (-not $Identity -or $Identity.Executable -notmatch $official -or [int]$Identity.SessionId -ne $SessionId) { throw 'CDP owner is not the official Codex in this session.' }
}

if ($FunctionsOnly) { return }
if ($Port -ne 9335) { throw 'Only the established Codex loopback port 9335 is supported.' }
$listeners = @(foreach ($line in @(& (Join-Path $env:WINDIR 'System32\netstat.exe') -ano -p TCP)) {
  if ($line -match ('^\s*TCP\s+(\S+):' + $Port + '\s+\S+\s+LISTENING\s+(\d+)\s*$')) {
    [pscustomobject]@{ Address = $Matches[1]; ProcessId = [int]$Matches[2] }
  }
})
if (-not $listeners.Count) { throw 'CDP listener unavailable.' }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class IntroListenerProcess {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process,int flags,StringBuilder path,ref int length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr process);
  [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(int id,out int session);
  public sealed class Identity { public string Executable; public int SessionId; }
  public static Identity Read(int id) {
    IntPtr process=OpenProcess(0x1000,false,id);if(process==IntPtr.Zero)return null;
    try { int length=32768,session;var path=new StringBuilder(length);
      if(!QueryFullProcessImageName(process,0,path,ref length)||!ProcessIdToSessionId(id,out session))return null;
      return new Identity {Executable=path.ToString(),SessionId=session};
    } finally {CloseHandle(process);}
  }
}
'@
$owners = @($listeners | Select-Object -ExpandProperty ProcessId -Unique)
$identity = if ($owners.Count -eq 1) { [IntroListenerProcess]::Read($owners[0]) } else { $null }
Assert-IntroListenerOwner -Listeners $listeners -Identity $identity -SessionId ([Diagnostics.Process]::GetCurrentProcess().SessionId)
Write-Output 'verified'
