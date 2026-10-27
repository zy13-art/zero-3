import test from 'node:test';
import assert from 'node:assert/strict';
import { installIntro } from '../overlay.mjs';
import { fakeWindow } from './fake-window.mjs';
test('the opaque cover mounts on documentElement before body or chat exists',()=>{
 const f=fakeWindow({body:false,root:false});assert.equal(installIntro(f.win,'early').installed,true);
 assert.equal(f.shell().parentNode,f.doc.documentElement);assert.equal(f.shell().style.background,'#000');assert.equal(f.video().style.objectFit,'contain');
});
test('the film remains black until its first presented frame and gets a fresh playback guard',()=>{
 const f=fakeWindow();installIntro(f.win,'film');const api=f.win.__kurumiIntro;
 api.begin();api.addChunk('AAAA');api.start();f.video().onplaying();
 assert.equal(api.status().firstFrame,false);assert.equal(f.video().style.opacity,'0');
 f.firstFrame();assert.equal(api.status().state,'playing');assert.equal(api.status().firstFrame,true);assert.equal(f.video().style.opacity,'1');
 assert.deepEqual([...f.timers.values()].map(x=>x.ms),[12000]);
 f.video().currentTime=8;f.video().ontimeupdate();assert.equal(f.win.__kurumiIntroResult.state,'ended');
});
test('Escape disposes only the owned layer, revokes resources and restores prior focus',()=>{
 const f=fakeWindow();installIntro(f.win,'skip');const api=f.win.__kurumiIntro;api.begin();api.addChunk('AAAA');api.start();
 let prevented=false,stopped=false;f.listeners.get('keydown')({key:'Escape',preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});
 assert.equal(f.win.__kurumiIntroResult.state,'skipped');assert.equal(f.shell().removed,true);assert.equal(f.original.focused,1);assert.deepEqual(f.win.URL.revoked,['blob:owned-film']);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);assert.ok(prevented&&stopped);
 api.dispose();assert.equal(f.original.focused,1);
});
test('late media callbacks and a repeated install cannot revive a completed session',()=>{
 const f=fakeWindow();installIntro(f.win,'once');const api=f.win.__kurumiIntro;const stale=[...f.timers.values()][0].fn;
 api.dispose('skipped');stale();assert.equal(f.win.__kurumiIntroResult.state,'skipped');
 assert.equal(installIntro(f.win,'once').terminal,true);assert.equal(f.elements.filter(x=>x.id==='kurumi-intro').length,1);
});
test('decode errors fail open and do not remove the chat body',()=>{
 const f=fakeWindow();installIntro(f.win,'error');f.video().error={message:'bad media'};f.video().onerror();
 assert.equal(f.win.__kurumiIntroResult.state,'error');assert.equal(f.win.__kurumiIntroResult.error,'bad media');assert.notEqual(f.doc.body.removed,true);
});
test('a new-document preload waits for documentElement and mounts once before body exists',()=>{
 const f=fakeWindow({body:false,root:false}),html=f.doc.documentElement;f.doc.documentElement=null;let callback,disconnected=false;
 f.win.MutationObserver=class{constructor(fn){callback=fn}observe(){}disconnect(){disconnected=true}};
 assert.equal(installIntro(f.win,'new-document').pending,true);assert.equal(f.shell().isConnected,false);
 f.doc.documentElement=html;callback();assert.equal(f.shell().parentNode,html);assert.equal(disconnected,true);
 callback();assert.equal(html.children.filter(x=>x.id==='kurumi-intro').length,1);
});
