import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
test('V2 inline script still parses',()=>assert.doesNotThrow(()=>new vm.Script(inline)));
test('failed API request preserves draft, unlocks composer, and allows manual retry',()=>{
 assert.match(inline,/if\(!input\.value\.trim\(\)\)input\.value=message/);
 assert.match(inline,/busy=false;input\.disabled=false;updateDeliveryGate\(\);updateComposerAction\(\)/);
 assert.match(inline,/Kiểm tra giỏ trước khi gửi lại/);
 assert.match(inline,/if\(!message\|\|busy\)return/);
});
