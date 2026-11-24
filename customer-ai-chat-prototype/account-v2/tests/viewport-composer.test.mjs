import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
const js=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
function rule(selector){
 const start=css.indexOf(selector+'{');
 return start<0?'':css.slice(start+selector.length+1).split('}',1)[0];
}

test('chat page uses real dynamic viewport height and no document-overflow gap',()=>{
 assert.match(html,/interactive-widget=resizes-content/);
 assert.match(rule('#app'),/height:100dvh/);
 assert.match(rule('#app'),/overflow:hidden/);
 assert.match(rule('main'),/min-height:0;overflow:hidden/);
 assert.match(rule('#chatView'),/flex:1 1 auto;min-height:0;overflow:hidden/);
 assert.match(html,/id="chatView"[^>]+min-height:0/);
});
test('messages take remaining viewport, never hardcode subtracting 305px',()=>{
 const messages=rule('#messages');
 assert.match(messages,/flex:1 1 auto/);
 assert.match(messages,/height:auto/);
 assert.match(messages,/min-height:0/);
 assert.match(messages,/overflow-y:auto/);
 assert.doesNotMatch(messages,/calc\(100dvh|305px|min-height:250px/);
});
test('composer docks directly below scrolling bubbles and honors safe area',()=>{
 const chat=html.match(/<section id="chatView"[\s\S]*?<\/section>/)?.[0]||'';
 assert.ok(chat.indexOf('id="messages"')>=0);
 assert.ok(chat.indexOf('class="composer"')>chat.indexOf('id="messages"'));
 assert.match(rule('.composer'),/position:relative;bottom:auto;flex:0 0 auto/);
 assert.match(rule('.composer'),/env\(safe-area-inset-bottom\)/);
 assert.match(rule('main>.view:not(.hidden)'),/overflow-y:auto/);
 assert.doesNotThrow(()=>new vm.Script(js));
});
