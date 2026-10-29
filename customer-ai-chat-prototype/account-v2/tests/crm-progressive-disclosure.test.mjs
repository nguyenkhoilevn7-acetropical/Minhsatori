import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

test('owner screen has separate panels, with nothing auto expanded',()=>{
 for(const tab of ['new','old','catalogue'])
  assert.match(html,new RegExp('data-owner-tab="'+tab+'"'));
 for(const group of ['pending','pricing','active','inactive'])
  assert.match(html,new RegExp('data-crm-stage="'+group+'" aria-pressed="false"'));
 for(const id of ['console','crmConsole','legacyConsole','crmInspector'])
  assert.match(html,new RegExp('id="'+id+'"[^>]* hidden'));
 assert.match(script,/let selectedCustomerStage=null,legacyListOpen=false/);
 assert.match(script,/if\(!selectedCustomerStage\)dest\.append/);
 assert.match(script,/for\(const x of legacyListOpen\?old:\[\]\)/);
 assert.match(script,/activateOwnerTab\('new'\)/);
 assert.match(script,/byId\('crmInspector'\)\.hidden=false/);
});

test('status transition uses protected existing admin API; never hard deletes invoice',()=>{
 assert.match(script,/status==='REMOVED'/);
 assert.match(script,/status==='SUSPENDED'/);
 assert.match(script,/changeAccountLifecycle\(rec,'ACTIVE',bps\)/);
 assert.match(script,/rec\.id===ownerAccountId/);
 assert.match(script,/status,expectedRevision:rec\.revision/);
 assert.match(script,/prompt\('Nhập XOA/);
 assert.match(script,/confirmed:true/);
 assert.match(backend,/DELETE FROM satori_v2_sessions WHERE account_id/);
 assert.match(backend,/CUSTOMER_ACCESS_/);
 assert.doesNotMatch(script,/\/api\/v2\/orders.*'DELETE'|\/api\/v2\/invoices.*'DELETE'/);
});

test('archived legacy contact is isolated from registered login',()=>{
 assert.match(html,/id="legacyLeadDisclosure"/);
 assert.match(script,/leadLifecycleControls\(x\)/);
 assert.match(script,/rec\.linkedAccountId/);
 assert.match(script,/\/api\/v2\/admin\/customer-leads','PATCH'/);
 assert.match(backend,/Archiving a linked contact DOES NOT revoke login/);
 assert.doesNotThrow(()=>new vm.Script(script));
});