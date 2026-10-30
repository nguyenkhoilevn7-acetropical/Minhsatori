import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';

test('old-customer main search finds actual signed recipient history, even without V2 account',()=>{
 assert.match(html,/id="crmSignedHistoryExactRows"/);
 assert.match(html,/id="crmSignedHistoryExactStatus"/);
 assert.match(script,/async function searchSignedOldCustomers\(\)/);
 assert.match(script,/\/api\/v2\/admin\/legacy\/search\?query=/);
 assert.match(script,/const query=byId\('crmOldFilter'\)\.value\.trim\(\)/);
 assert.match(script,/byId\('crmOldSearch'\)\.addEventListener\('click'/);
 assert.match(script,/byId\('crmOldFilter'\)\.addEventListener\('keydown'/);
 assert.match(script,/for\(const group of data\.addressGroups\)/);
 assert.match(script,/group\.address/);
 assert.match(script,/group\.invoiceCount/);
 assert.match(script,/data\.truncated/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
test('signed historical search only reads original ledger, with explicit owner linking',()=>{
 assert.match(router,/if\(pathname==='\/api\/v2\/admin\/legacy\/search'&&req.method==='GET'\)\{\s*owner\(actor\)/);
 assert.match(backend,/export async function legacyCustomerSearch\(query\)/);
 assert.match(backend,/readMinhSatori\('orders\.list',\{query:q,limit:100\}\)/);
 const match=script.split('async function searchSignedOldCustomers(){')[1]
  ?.split("byId('crmOldSearch').addEventListener")[0]||'';
 assert.match(match,/Đối chiếu & liên kết khi xác nhận đúng chủ/);
 assert.doesNotMatch(match,/\/api\/v2\/admin\/legacy\/(?:bind-history|activate)|\/api\/v2\/admin\/customers','PATCH'/);
 assert.doesNotMatch(match,/INSERT INTO|UPDATE satori_v2/);
});
