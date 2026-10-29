import test from 'node:test';
import assert from 'node:assert/strict';
import {installIntro} from '../overlay.mjs';
import {fakeWindow} from './fake-window.mjs';

test('a sixteen second film stays visible past eight seconds and ends at its real duration',()=>{
 const f=fakeWindow();installIntro(f.win,'baili');const api=f.win.__kurumiIntro;
 f.video().duration=16;api.begin();api.addChunk('AAAA');api.start();f.firstFrame();
 f.video().currentTime=8;f.video().ontimeupdate();
 assert.equal(f.shell().isConnected,true,'16-second film must not be truncated at 8 seconds');
 assert.ok([...f.timers.values()][0].ms>=20000,'watchdog must allow the full film plus decoding headroom');
 f.video().currentTime=15.9;f.video().ontimeupdate();assert.equal(f.shell().isConnected,true);
 f.video().currentTime=16;f.video().ontimeupdate();assert.equal(f.win.__kurumiIntroResult.state,'ended');
 assert.equal(f.timers.size,0);assert.equal(f.original.focused,1);
});
