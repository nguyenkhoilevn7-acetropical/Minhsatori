import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const withoutUi25d=html=>html
 .replace(/<style id="s25-ui-style">[\s\S]*?<\/style>/,'')
 .replace(/<template id="s25-ui-template">[\s\S]*?<\/template>/,'')
 .replace(/<script id="s25-ui-script">[\s\S]*?<\/script>/,'');
const block=router.slice(router.indexOf("if(pathname==='/api/v2/admin/catalogue/readiness'"),
 router.indexOf("if(pathname==='/api/v2/catalogue'"));

test('dedicated owner catalogue console is separate from the customer ordering UI',()=>{
 assert.match(router,/const ownerPage=pathname==='\/owner-v2'\|\|pathname==='\/owner-v2\/'/);
 assert.match(router,/ownerPage\?'owner-catalogue\.html':'app\.html'/);
 assert.match(html,/<html lang="vi">/);
 assert.match(html,/name="viewport"/);
 assert.match(html,/href="\/app-v2"/);
 assert.doesNotMatch(html,/GEMINI_API_KEY|SATORI_READ_HMAC_SECRET|SATORI_READ_KEY_ID/);
});
test('only a valid Admin session may reveal catalogue readiness and trigger sync',()=>{
 assert.match(block,/owner\(actor\);/);
 assert.match(block,/WHERE active=true/);
 assert.match(block,/readTransportConfigured:readOnlyReady\(\)/);
 assert.doesNotMatch(block,/INSERT INTO|UPDATE satori|DELETE FROM|\.secret|HMAC_SECRET/);
 assert.match(html,/if\(!me\?\.account\?\.isAdmin\)throw Error\('ADMIN_REQUIRED'\)/);
 assert.match(html,/if\(!isOwner\|\|busy\|\|!sourceReady\)return/);
 assert.match(html,/x-satori-csrf/);
 assert.match(html,/confirmed:true/);
 assert.match(html,/credentials:'same-origin'/);
 assert.match(html,/cache:'no-store'/);
});
test('admin panel is guarded against unsafe html injection and unauthorized price writes',()=>{
 assert.doesNotMatch(withoutUi25d(html),/\.innerHTML\s*=|insertAdjacentHTML|eval\(/);
 const cosmetic=html.match(/<script id="s25-ui-script">([\s\S]*?)<\/script>/)?.[1]||'';
 assert.doesNotMatch(cosmetic,/\.innerHTML\s*=|insertAdjacentHTML|eval\(|fetch\(|\/api\/v2\//);
 assert.match(html,/\.textContent=/);
 assert.match(html,/readTransportConfigured===true/);
 assert.match(html,/quyền thực tế sẽ được xác minh khi đồng bộ/i);
 assert.doesNotMatch(html,/\/api\/v2\/quote|\/api\/v2\/orders\/confirm/);
 assert.match(html,/Đồng bộ thành công/);
});
