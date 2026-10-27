import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),script=fileURLToPath(new URL('../Verify-CodexListener.ps1',import.meta.url));
test('independent listener verification rejects impostors, remote binding and ambiguous owners',async()=>{
 const command=`$ErrorActionPreference='Stop'
. '${script.replaceAll("'","''")}' -FunctionsOnly
$root=Join-Path $env:ProgramFiles 'WindowsApps'
$official=Join-Path $root 'OpenAI.Codex_1.2.3.4_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe'
$identity=@{Executable=$official;SessionId=44}
Assert-IntroListenerOwner -Listeners @([pscustomobject]@{Address='127.0.0.1';ProcessId=123}) -Identity $identity -SessionId 44
$cases=@(
 @{Listeners=@([pscustomobject]@{Address='127.0.0.1';ProcessId=123});Identity=@{Executable='C:\\impostor\\ChatGPT.exe';SessionId=44}},
 @{Listeners=@([pscustomobject]@{Address='0.0.0.0';ProcessId=123});Identity=$identity},
 @{Listeners=@([pscustomobject]@{Address='127.0.0.1';ProcessId=123},[pscustomobject]@{Address='[::1]';ProcessId=456});Identity=$identity},
 @{Listeners=@([pscustomobject]@{Address='127.0.0.1';ProcessId=123});Identity=@{Executable=$official;SessionId=99}}
)
foreach($case in $cases){$rejected=$false;try{Assert-IntroListenerOwner -Listeners $case.Listeners -Identity $case.Identity -SessionId 44}catch{$rejected=$true};if(-not $rejected){throw 'Unsafe listener accepted'}}
Write-Output 'PASS all owner fixtures'
`;
 const result=await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{windowsHide:true,timeout:10000});
 assert.match(result.stdout,/PASS all owner fixtures/);
});
