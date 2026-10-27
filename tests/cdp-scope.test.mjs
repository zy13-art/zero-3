import test from 'node:test';
import assert from 'node:assert/strict';
import {mainTarget,socketUrl} from '../cdp.mjs';
test('only the official app main-document origin is eligible',()=>{
 const page=url=>({type:'page',url});
 assert.equal(mainTarget(page('app://-/index.html?initialRoute=%2Flocal%2Ffixture')),true);
 for(const url of ['https://example.com/index.html','app://evil/index.html','app://user@-/index.html','app://-:99/index.html','app://-/index.html?initialRoute=%2Fquick-chat','app://-/index.html?initialRoute=%2Fmini'])assert.equal(mainTarget(page(url)),false,url);
});
test('CDP sockets must stay on the established loopback page endpoint',()=>{
 assert.equal(socketUrl('ws://127.0.0.1:9335/devtools/page/main',9335),'ws://127.0.0.1:9335/devtools/page/main');
 for(const url of ['ws://example.com:9335/devtools/page/main','ws://127.0.0.1:1/devtools/page/main','ws://user@127.0.0.1:9335/devtools/page/main','ws://127.0.0.1:9335/devtools/browser/main'])assert.throws(()=>socketUrl(url,9335));
});
