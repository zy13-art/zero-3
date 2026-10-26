import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { runWithLaunchLease } from '../launch-lease.mjs';

const pipeName = () => String.raw`\\.\pipe\codex-kurumi-test-${process.pid}-${randomUUID()}`;

test('overlapping launch runs only the first action until it finishes', { timeout: 5000 }, async () => {
  const name = pipeName();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let runs = 0;
  const first = runWithLaunchLease(name, async () => {
    runs++;
    entered.resolve();
    await release.promise;
    return 'first completed';
  });
  await entered.promise;
  try {
    const duplicate = await runWithLaunchLease(name, () => { runs++; return 'duplicate'; });
    assert.deepEqual(duplicate, { acquired: false });
    assert.equal(runs, 1);
  } finally { release.resolve(); }
  assert.deepEqual(await first, { acquired: true, value: 'first completed' });
});

test('a completed launch releases its lease for the next invocation', { timeout: 5000 }, async () => {
  const name = pipeName();
  assert.deepEqual(await runWithLaunchLease(name, () => 1), { acquired: true, value: 1 });
  assert.deepEqual(await runWithLaunchLease(name, () => 2), { acquired: true, value: 2 });
});

test('an action failure propagates and releases its lease', { timeout: 5000 }, async () => {
  const name = pipeName(), failure = new Error('launch failed');
  await assert.rejects(runWithLaunchLease(name, async () => { throw failure; }), error => error === failure);
  assert.deepEqual(await runWithLaunchLease(name, () => 'retry'), { acquired: true, value: 'retry' });
});

test('a competing process is excluded and process exit releases the OS lease', { timeout: 10000 }, async t => {
  const name = pipeName();
  const moduleUrl = new URL('../launch-lease.mjs', import.meta.url).href;
  const code = `import { runWithLaunchLease } from ${JSON.stringify(moduleUrl)};
    await runWithLaunchLease(process.argv[1], async () => {
      process.stdout.write('held\\n');
      await new Promise(() => process.stdin.once('data', () => process.exit(0)));
    });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, name],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let errorText = '';
  child.stderr.on('data', data => { errorText += data; });
  const exited = once(child, 'exit');
  const ready = await Promise.race([
    once(child.stdout, 'data').then(([data]) => data.toString()),
    exited.then(([code]) => { throw new Error(`Child exited before acquiring lease (${code}): ${errorText}`); })
  ]);
  assert.equal(ready, 'held\n');
  let duplicateRan = false;
  assert.deepEqual(await runWithLaunchLease(name, () => { duplicateRan = true; }), { acquired: false });
  assert.equal(duplicateRan, false);
  child.stdin.end('exit without finally\n');
  assert.equal((await exited)[0], 0);
  assert.deepEqual(await runWithLaunchLease(name, () => 'recovered'), { acquired: true, value: 'recovered' });
});
