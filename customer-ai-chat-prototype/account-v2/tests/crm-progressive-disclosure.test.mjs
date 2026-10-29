import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');

test('CRM owner tabs are distinct and collapsed by default',()=>{
 for(const tab of ['new','old','catalogue'])
  assert.match(html,new RegExp('data-owner-tab="'+tab+'"'));
 for(const id of ['crmConsole','legacyConsole','console'])
  assert.match(html,new RegExp('id="'+id+'"[^>]* hidden'));
 assert.match(html,/id="crmInspector" class="crm-inspector" hidden/);
 assert.match(html,/id="legacyLeadDisclosure"/);
 assert.doesNotMatch(html,/id="legacyLedgerDisclosure"/);
 assert.match(html,/id="crmLegacyLink"/);
 assert.match(script,/let selectedOwnerGroup=null/);
 assert.match(script,/selectedOwnerGroup===g\.state/);
 assert.match(script,/const item=make\('details',null,'crm-entry crm-customer-card/);
 assert.match(script,/resetCustomerInspector\(\)/);
 assert.match(html,/id="crmOldFilter" type="search"/);
 assert.match(script,/activateOwnerTab\('new'\)/);
 assert.match(script,/byId\('crmInspector'\)\.hidden=false/);
});
test('existing owner status API provides suspend, revoke, and explicit CTV reactivation',()=>{
 assert.match(script,/changeAccountLifecycle\(rec,'SUSPENDED'\)/);
 assert.match(script,/changeAccountLifecycle\(rec,'REMOVED'\)/);
 assert.match(script,/changeAccountLifecycle\(rec,'ACTIVE',bps,cbps\)/);
 assert.match(script,/rec\.id===ownerAccountId/);
 assert.match(script,/expectedRevision:rec\.revision,confirmed:true/);
 assert.match(script,/prompt\('Nhập XOA/);
 assert.match(script,/cbps<bps/);
 assert.match(backend,/DELETE FROM satori_v2_sessions WHERE account_id/);
 assert.match(backend,/CUSTOMER_ACCESS_/);
 assert.doesNotMatch(script,/\/api\/v2\/(?:orders|invoices).*'DELETE'/);
});
test('unlinked old leads can archive without touching live Google login or invoices',()=>{
 assert.match(script,/leadLifecycleControls\(x\)/);
 assert.match(script,/\/api\/v2\/admin\/customer-leads','PATCH'/);
 assert.match(script,/rec\.linkedAccountId/);
 assert.match(backend,/Archiving a linked contact DOES NOT revoke login/);
 assert.doesNotThrow(()=>new vm.Script(script));
});