param([string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ChatGPT.lnk'))
$ErrorActionPreference = 'Stop'
$package = Split-Path -Parent $MyInvocation.MyCommand.Path
$backup = Join-Path $package 'ChatGPT-original.lnk'
$launcher = Join-Path $package 'CodexKurumiIntro.exe'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Build the native launcher before installing the shortcut.' }
if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { throw "Shortcut not found: $ShortcutPath" }
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { Copy-Item -LiteralPath $ShortcutPath -Destination $backup }
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($ShortcutPath)
$originalIcon = $link.IconLocation
$link.TargetPath = $launcher
$link.Arguments = ''
$link.WorkingDirectory = $package
$link.Description = 'Codex · 时崎狂三随机入场动画'
if ($originalIcon) { $link.IconLocation = $originalIcon }
$link.Save()
$verify = $shell.CreateShortcut($ShortcutPath)
if ($verify.TargetPath -ne $link.TargetPath -or $verify.Arguments -ne $link.Arguments -or $verify.IconLocation -ne $link.IconLocation -or $verify.WorkingDirectory -ne $link.WorkingDirectory) { throw 'Shortcut verification failed' }
Write-Output "Updated $ShortcutPath; original backup: $backup"
