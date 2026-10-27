import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../',import.meta.url));
const framework = join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319');

test('the production watchdog gives decoder startup and opened playback separate budgets without showing UI',async()=>{
  const fixture = await mkdtemp(join(tmpdir(),'kurumi-watchdog-'));
  for(const [from,to] of [['NativeStartup.cs','NativeStartup.cs'],['tests/NativeWatchdogHarness.cs','NativeWatchdogHarness.cs']]) {
    await copyFile(join(root,from),join(fixture,to));
  }
  const executable = join(fixture,'watchdog.exe');
  const references = ['System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','System.Xaml.dll'].map(name=>join(framework,name));
  references.push(...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(name=>join(framework,'WPF',name)));
  await exec(join(framework,'csc.exe'),['/nologo','/target:exe','/platform:x64','/main:KurumiStartup.NativeWatchdogHarness',`/out:${executable}`,...references.map(path=>`/reference:${path}`),join(fixture,'NativeStartup.cs'),join(fixture,'NativeWatchdogHarness.cs')],{windowsHide:true,timeout:20000});
  let result;
  try { result = await exec(executable,[],{windowsHide:true,timeout:10000}); }
  catch(error) { assert.fail(`Production watchdog regression failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`); }
  assert.equal((result.stdout.match(/^PASS /gm) ?? []).length,5,result.stdout);
});
