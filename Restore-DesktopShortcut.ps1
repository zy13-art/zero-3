param([string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ChatGPT.lnk'))
$ErrorActionPreference = 'Stop'
$package = Split-Path -Parent $MyInvocation.MyCommand.Path
$backup = Join-Path $package 'ChatGPT-original.lnk'
$nativeLauncher = Join-Path $package 'CodexKurumiIntro.exe'
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { throw 'Original shortcut backup is missing' }
if (Test-Path -LiteralPath $ShortcutPath -PathType Leaf) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($ShortcutPath)
  if ($link.TargetPath -ine $nativeLauncher -and $link.Arguments -notlike '*CodexKurumiIntro*Launch.ps1*') { throw 'Desktop shortcut has changed since installation; refusing to overwrite it' }
}
Copy-Item -LiteralPath $backup -Destination $ShortcutPath -Force
Write-Output "Restored $ShortcutPath"
