import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/);
test('new V2 preview JavaScript parses in Chrome-compatible ECMAScript',()=>{
 assert.ok(inline,'inline application code present');
 assert.doesNotThrow(()=>new vm.Script(inline[1],{filename:'account-v2/app.html'}));
});
test('preview banner is explicit, synthetic and guarded against live network actions',()=>{
 assert.match(html,/id="previewBanner"/);
 assert.match(html,/DỮ LIỆU GIẢ/);
 assert.match(html,/GEMINI CHƯA KÍCH HOẠT/);
 assert.match(html,/const PREVIEW=new URLSearchParams\(location.search\).get\('preview'\)==='1'/);
 assert.match(inline[1],/if\(PREVIEW\)return demoCall\(path,data,method\)/);
 assert.match(inline[1],/if\(p==='\/api\/v2\/admin\/catalogue\/refresh'\)throw Error/);
 assert.match(html,/id="confirm"[^>]+disabled/);
});
test('self-serve address edit requires explicit confirmation and a revision',()=>{
 assert.match(html,/id="userAddressEditor"/);
 assert.match(html,/id="saveUserAddress"/);
 assert.match(inline[1],/expectedRevision:userAddressDraftDirty&&userAddressDraftId===old\.id&&/);
 assert.match(inline[1],/userAddressDraftProfileId===old\.profileId\?userAddressDraftRevision:old\.revision/);
 assert.match(inline[1],/confirmed:true,label:\$\('userEditLabel'\)\.value/);
 assert.match(inline[1],/if\(e\.message==='ADDRESS_REVISION_CONFLICT'\)/);
});
