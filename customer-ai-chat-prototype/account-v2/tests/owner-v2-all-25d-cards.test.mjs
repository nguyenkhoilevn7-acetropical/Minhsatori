import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const ui=html.match(/<style id="s25-ui-style">([\s\S]*?)<\/style>/)?.[1]||'';
const app=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';

test('all three owner V2 tabs use one 2.5D theme and responsive nested cards',()=>{
 for(const id of ['crmConsole','legacyConsole','console'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(ui,/V2 OWNER: unified 2\.5D depth/);
 assert.match(ui,/#crmConsole,#legacyConsole,#console/);
 assert.match(ui,/#console :is\(\.metric,details,#notice,\.actions\)/);
 assert.match(ui,/#legacyConsole :is\(\.crm-customer-card/);
 assert.match(ui,/#crmStageFilters\.crm-filter-row/);
 assert.match(ui,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(ui,/max-width:760px/);
 assert.match(ui,/var\(--s25-shadow\)/);
 assert.match(ui,/prefers-reduced-motion:reduce/);
});
test('customer identity, address and real Vietnam registration time remain visible',()=>{
 assert.match(app,/identity\.append\(address\)/);
 assert.match(app,/record\.address\|\|'Chưa có địa chỉ giao hàng'/);
 assert.match(app,/record\.submittedAt\|\|record\.createdAt/);
 assert.match(app,/timeZone:'Asia\/Ho_Chi_Minh'/);
 assert.match(app,/meta\.prepend\(time\)/);
 assert.match(ui,/crm-registration-time/);
 assert.doesNotThrow(()=>new vm.Script(app));
});
test('customer list has one refresh; Gmail reconciliation remains a separate action',()=>{
 assert.equal((html.match(/id="crmRefresh"/g)||[]).length,1);
 assert.doesNotMatch(html,/↻ Đối chiếu Gmail khách cũ/);
 assert.match(html,/id="crmAutoLinkPending"/);
 assert.match(app,/byId\('crmRefresh'\)\.addEventListener\('click',loadCustomers\)/);
 assert.match(app,/\/api\/v2\/admin\/legacy\/reconcile-pending/);
});
