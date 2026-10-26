$ErrorActionPreference = 'Stop'
$package = Split-Path -Parent $MyInvocation.MyCommand.Path
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$wpf = Join-Path $framework 'WPF'
$references = @('System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','System.Xaml.dll')
$arguments = @('/nologo','/target:winexe','/platform:x64','/optimize+',('/out:' + (Join-Path $package 'CodexKurumiIntro.exe')))
foreach ($reference in $references) { $arguments += '/reference:' + (Join-Path $framework $reference) }
foreach ($reference in @('WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll')) { $arguments += '/reference:' + (Join-Path $wpf $reference) }
$arguments += Join-Path $package 'NativeStartup.cs'
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Native startup compilation failed.' }
Write-Output (Join-Path $package 'CodexKurumiIntro.exe')
