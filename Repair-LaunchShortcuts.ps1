param(
  [Parameter(Mandatory=$true)][string[]]$ShortcutPaths,
  [string]$BackupRoot = (Join-Path $PSScriptRoot 'shortcut-backups'),
  [string]$FallbackIcon = '',
  [switch]$Restore
)
$ErrorActionPreference='Stop'
$launcher=Join-Path $PSScriptRoot 'CodexKurumiIntro.exe'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Native launcher is missing.' }
$shell=New-Object -ComObject WScript.Shell
$journalPath=Join-Path $BackupRoot 'manifest.json'
$records=@()
if (Test-Path -LiteralPath $journalPath) {
  $records=@((Get-Content -LiteralPath $journalPath -Raw -Encoding UTF8 | ConvertFrom-Json).entries)
}
$jobs=@()
foreach ($path in $ShortcutPaths) {
  $full=[IO.Path]::GetFullPath($path)
  if ([IO.Path]::GetExtension($full) -ne '.lnk' -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Existing shortcut required: $full" }
  $link=$shell.CreateShortcut($full)
  $row=@($records | Where-Object { $_.path -eq $full }) | Select-Object -First 1
  if ($Restore) {
    if (-not $row -or -not (Test-Path -LiteralPath $row.backup)) { throw "Original backup missing: $full" }
    if ((Get-FileHash -LiteralPath $row.backup -Algorithm SHA256).Hash -ne $row.sha256) { throw "Backup hash mismatch: $full" }
    if ($link.TargetPath -ne $launcher -and (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ne $row.sha256) { throw "Shortcut changed independently; refusing to overwrite: $full" }
  } else {
    $official='\\WindowsApps\\OpenAI\.Codex_\d+\.\d+\.\d+\.\d+_(?:x64|arm64|x86)__2p2nqsd0c76g0\\app\\ChatGPT\.exe$'
    if ($link.TargetPath -ne $launcher -and $link.TargetPath -notmatch $official) { throw "Unrelated target; refusing to modify: $full" }
    if ($link.TargetPath -eq $launcher -and -not $row) { throw "An original backup is required for an already modified entry: $full" }
  }
  $jobs += [pscustomobject]@{path=$full;link=$link;record=$row}
}
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
foreach ($job in $jobs) {
  if ($Restore) { Copy-Item -LiteralPath $job.record.backup -Destination $job.path; continue }
  if (-not $job.record) {
    $hasher=[Security.Cryptography.SHA256]::Create()
    try { $key=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($job.path.ToLowerInvariant())))).Replace('-','').Substring(0,16) } finally { $hasher.Dispose() }
    $backup=Join-Path $BackupRoot ($key+'.lnk')
    if (Test-Path -LiteralPath $backup) { throw "Untracked backup already exists: $backup" }
    Copy-Item -LiteralPath $job.path -Destination $backup
    $row=[pscustomobject]@{path=$job.path;backup=$backup;sha256=(Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash;originalTarget=$job.link.TargetPath}
    $records+= $row
    @{entries=@($records)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $journalPath -Encoding UTF8
  }
  # Updating an official link in place retains com.openai.codex identity data.
  # A fresh link avoids having a pinned entry resolve back to the official app.
  $pending=Join-Path $BackupRoot ([guid]::NewGuid().ToString('N')+'.pending.lnk')
  $fresh=$shell.CreateShortcut($pending)
  $fresh.TargetPath=$launcher
  $fresh.Arguments=''
  $fresh.WorkingDirectory=$PSScriptRoot
  $fresh.Description='Codex startup animation'
  $fresh.IconLocation=$job.link.IconLocation
  if ($job.link.Hotkey) { $fresh.Hotkey=$job.link.Hotkey }
  $fresh.WindowStyle=$job.link.WindowStyle
  if ($FallbackIcon -and (!$fresh.IconLocation -or $fresh.IconLocation -eq ',0')) { $fresh.IconLocation=$FallbackIcon }
  $fresh.Save()
  Copy-Item -LiteralPath $pending -Destination $job.path
  Remove-Item -LiteralPath $pending
  $verify=$shell.CreateShortcut($job.path)
  if ($verify.TargetPath -ne $launcher -or $verify.Arguments -ne '' -or $verify.WorkingDirectory -ne $PSScriptRoot) { throw "Shortcut verification failed: $($job.path)" }
}
try {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class KurumiShortcutRefresh { [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern void SHChangeNotify(uint e,uint f,string a,IntPtr b); }'
  foreach ($job in $jobs) { [KurumiShortcutRefresh]::SHChangeNotify(0x2000,0x0005,$job.path,[IntPtr]::Zero) }
} catch { Write-Warning 'Shortcut files were updated; Explorer will refresh them on its next read.' }
Write-Output (@{restored=[bool]$Restore;shortcuts=@($jobs.path);backup=$journalPath} | ConvertTo-Json -Depth 4 -Compress)
