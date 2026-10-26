$ErrorActionPreference = 'Stop'
$package = Split-Path -Parent $MyInvocation.MyCommand.Path
try {
  $player = Join-Path $package 'CodexKurumiIntro.exe'
  if (-not (Test-Path -LiteralPath $player -PathType Leaf)) { & (Join-Path $package 'Build-NativeStartup.ps1') | Out-Null }
  $run = Start-Process -FilePath $player -WorkingDirectory $package -WindowStyle Normal -PassThru -Wait
  if ($run.ExitCode -ne 0) { throw ('Startup animation failed. Details: ' + (Join-Path $package 'native-startup.log')) }
} catch {
  Add-Content -LiteralPath (Join-Path $package 'launcher.log') -Value ((Get-Date -Format o) + ' ' + $_.Exception.Message)
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Codex startup animation')
  exit 1
}
