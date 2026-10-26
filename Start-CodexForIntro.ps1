param([switch]$FunctionsOnly, [switch]$NativeSplash)
$ErrorActionPreference = 'Stop'

function Test-KurumiOfficialCodexExecutable {
  param([string]$Candidate)
  if ([string]::IsNullOrWhiteSpace($Candidate) -or -not [System.IO.Path]::IsPathRooted($Candidate)) { return $false }
  try {
    $full = [System.IO.Path]::GetFullPath($Candidate)
    $programFiles = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
    $windowsApps = Join-Path $programFiles 'WindowsApps'
    $official = '^' + [regex]::Escape($windowsApps) + '\\OpenAI\.Codex_\d+\.\d+\.\d+\.\d+_(?:x64|arm64|x86)__2p2nqsd0c76g0\\app\\ChatGPT\.exe$'
    return ($full -match $official) -and (Test-Path -LiteralPath $full -PathType Leaf)
  } catch { return $false }
}

function Resolve-KurumiCodexExecutable {
  param(
    [Parameter(Mandatory = $true)]$Settings,
    [string[]]$AppxCandidates,
    [string[]]$ProcessCandidates
  )
  # Explicit candidate arrays keep resolver tests read-only and deterministic.
  if (-not $PSBoundParameters.ContainsKey('AppxCandidates')) {
    $AppxCandidates = @()
    try {
      $packages = @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Sort-Object Version -Descending)
      foreach ($package in $packages) {
        if ($package.InstallLocation) { $AppxCandidates += Join-Path $package.InstallLocation 'app\ChatGPT.exe' }
      }
    } catch {}
  }
  if (-not $PSBoundParameters.ContainsKey('ProcessCandidates')) {
    $ProcessCandidates = @()
    foreach ($process in @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)) {
      try { if ($process.Path) { $ProcessCandidates += $process.Path } } catch {}
    }
  }
  foreach ($candidate in @($AppxCandidates) + @($ProcessCandidates) + @([string]$Settings.codexExecutable)) {
    if (Test-KurumiOfficialCodexExecutable -Candidate $candidate) { return [System.IO.Path]::GetFullPath($candidate) }
  }
  throw 'The official Codex executable could not be found. Update codexExecutable in config.json to the installed WindowsApps Codex app path.'
}

function Test-KurumiCdpReady {
  param([int]$Port = 9335)
  try {
    $reply = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1
    $socket = [uri]$reply.webSocketDebuggerUrl
    return $socket.Scheme -eq 'ws' -and $socket.Host -eq '127.0.0.1' -and $socket.Port -eq $Port
  } catch { return $false }
}

if ($FunctionsOnly) { return }

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($NativeSplash) {
  # This child outlives the splash when Codex starts slowly; log independently.
  Start-Transcript -LiteralPath (Join-Path $packageRoot 'bootstrap.log') -Append -ErrorAction SilentlyContinue | Out-Null
}
$settings = Get-Content -LiteralPath (Join-Path $packageRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$port = 9335
if ($settings.port -and [int]$settings.port -ne $port) { throw 'The intro bootstrap expects the existing loopback port 9335.' }

if (-not (Test-KurumiCdpReady -Port $port)) {
  $processCandidates = @()
  $unverifiedProcesses = @()
  foreach ($process in @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)) {
    $path = $null
    try { $path = $process.Path } catch {}
    if ($path) { $processCandidates += $path }
    else { $unverifiedProcesses += $process.Id }
  }
  if (@($processCandidates | Where-Object { Test-KurumiOfficialCodexExecutable -Candidate $_ }).Count) {
    if ($NativeSplash) { Write-Output 'Existing Codex preserved; native playback does not require CDP.'; exit 0 }
    throw 'Codex is already running without the intro connection. Its session was preserved; exit Codex normally before using this shortcut.'
  }
  if ($unverifiedProcesses.Count) {
    if ($NativeSplash) { Write-Output 'Existing unidentified app process preserved; native playback is independent.'; exit 0 }
    throw 'An existing ChatGPT process could not be identified. It was left untouched; exit Codex normally before using this shortcut.'
  }
  $executable = Resolve-KurumiCodexExecutable -Settings $settings -ProcessCandidates $processCandidates
  $stateRoot = Join-Path $env:LOCALAPPDATA 'CodexChatWallpaper'
  $profile = Join-Path $stateRoot 'profile'
  New-Item -ItemType Directory -Path $stateRoot,$profile -Force | Out-Null
  $arguments = "--remote-debugging-port=$port --remote-debugging-address=127.0.0.1 --user-data-dir=`"$profile`""
  # This is the interactive Codex window explicitly requested by its shortcut.
  Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Normal | Out-Null
  $deadline = [datetime]::UtcNow.AddSeconds(45)
  $ready = $false
  while ([datetime]::UtcNow -lt $deadline) {
    if (Test-KurumiCdpReady -Port $port) { $ready = $true; break }
    Start-Sleep -Milliseconds 400
  }
  if (-not $ready) { throw 'Codex launched but its loopback intro connection did not become ready within 45 seconds. No process was closed.' }
}

# -NoLaunch preserves all running app sessions. The existing script verifies the
# listener's official owner and ensures the established wallpaper watcher exists.
$wallpaperStart = $null
try {
  $wallpaperRoot = [System.IO.Path]::GetFullPath([string]$settings.wallpaperProject)
  $wallpaperStart = Join-Path $wallpaperRoot 'start.ps1'
} catch {}
if (-not $wallpaperStart -or -not (Test-Path -LiteralPath $wallpaperStart -PathType Leaf)) {
  if ($NativeSplash) { Write-Output 'Codex startup preserved; optional wallpaper project is missing.'; exit 0 }
  throw "Wallpaper startup script was not found: $wallpaperStart"
}
& $wallpaperStart -NoLaunch
if ($LASTEXITCODE -ne 0) { throw "Wallpaper startup failed with exit code $LASTEXITCODE" }
