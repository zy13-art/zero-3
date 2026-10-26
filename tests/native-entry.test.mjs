import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, copyFile, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../',import.meta.url));
const ps = (args) => exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',...args],{windowsHide:true,timeout:20000});
const quote = value => "'"+value.replaceAll("'","''")+"'";

test('a moved wallpaper project cannot cancel the native app startup', async () => {
  const fixture = await mkdtemp(join(tmpdir(),'kurumi-bootstrap-'));
  await copyFile(join(root,'Start-CodexForIntro.ps1'),join(fixture,'Start-CodexForIntro.ps1'));
  const settings = JSON.parse(await readFile(join(root,'config.json'),'utf8'));
  settings.wallpaperProject = join(fixture,'missing-wallpaper');
  await writeFile(join(fixture,'config.json'),JSON.stringify(settings),'utf8');
  const wrapper = join(fixture,'test-bootstrap.ps1');
  await writeFile(wrapper,`
function Start-Process { throw 'The bootstrap test must never launch an application.' }
function Invoke-RestMethod {
  [pscustomobject]@{ webSocketDebuggerUrl = 'ws://127.0.0.1:9335/devtools/browser/test-fixture' }
}
& ${quote(join(fixture,'Start-CodexForIntro.ps1'))} -NativeSplash
`,'utf8');
  const result = await ps(['-File',wrapper]);
  assert.match(result.stdout,/optional wallpaper project is missing/i);
});

test('installation starts the native cover directly and restoration returns the original shortcut', async () => {
  const fixture = await mkdtemp(join(tmpdir(),'kurumi-shortcut-'));
  const link = join(fixture,'ChatGPT.lnk');
  for (const name of ['Install-DesktopShortcut.ps1','Restore-DesktopShortcut.ps1','CodexKurumiIntro.exe']) {
    await copyFile(join(root,name),join(fixture,name));
  }
  const { stdout: originalInfo } = await ps(['-Command',`
$s=New-Object -ComObject WScript.Shell
$l=$s.CreateShortcut(${quote(link)})
$l.TargetPath=$env:ComSpec
$l.Arguments='/c exit 0'
$l.WorkingDirectory=${quote(fixture)}
$l.IconLocation=(Join-Path $env:WINDIR 'System32\\shell32.dll')+',0'
$l.Save()
@{icon=$l.IconLocation}|ConvertTo-Json -Compress
`]);
  const originalIcon = JSON.parse(originalInfo.trim()).icon;
  const original = await readFile(link);
  await ps(['-File',join(fixture,'Install-DesktopShortcut.ps1'),'-ShortcutPath',link]);
  const { stdout } = await ps(['-Command',`$s=New-Object -ComObject WScript.Shell; $l=$s.CreateShortcut(${quote(link)}); @{target=$l.TargetPath;args=$l.Arguments;icon=$l.IconLocation}|ConvertTo-Json -Compress`]);
  const installed = JSON.parse(stdout.trim());
  assert.equal(installed.target.toLowerCase(),join(fixture,'CodexKurumiIntro.exe').toLowerCase());
  assert.equal(installed.args,'');
  assert.equal(installed.icon,originalIcon);
  assert.deepEqual(await readFile(join(fixture,'ChatGPT-original.lnk')),original);
  await ps(['-File',join(fixture,'Restore-DesktopShortcut.ps1'),'-ShortcutPath',link]);
  assert.deepEqual(await readFile(link),original);
});

test('missing media fails without creating a persistent cover in preview mode', async () => {
  const fixture = await mkdtemp(join(tmpdir(),'kurumi-media-'));
  await copyFile(join(root,'CodexKurumiIntro.exe'),join(fixture,'CodexKurumiIntro.exe'));
  await writeFile(join(fixture,'config.json'),JSON.stringify({playlist:['absent.mp4']}),'utf8');
  await assert.rejects(exec(join(fixture,'CodexKurumiIntro.exe'),['--preview'],{windowsHide:true,timeout:5000}),error=>error.code===1);
  const journal = (await readFile(join(fixture,'native-startup.log'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(journal.some(x=>x.event==='LauncherError'));
  assert.ok(!journal.some(x=>x.event==='CoverShown'||x.event==='BootstrapStarted'));
});
