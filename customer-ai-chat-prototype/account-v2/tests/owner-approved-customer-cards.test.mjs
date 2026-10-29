import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';

test('one top icon tab row only, no duplicate text navigation, auth minimized',()=>{
 assert.equal((html.match(/id="ownerTabs"/g)||[]).length,1);
 assert.ok(html.indexOf('<header class="owner-header">')<html.indexOf('id="ownerTabs"'));
 assert.ok(html.indexOf('id="ownerTabs"')<html.indexOf('id="ownerAuth"'));
 const nav=html.match(/<nav id="ownerTabs"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.deepEqual([...nav.matchAll(/data-owner-tab="([^"]+)"/g)].map(x=>x[1]),['new','old','catalogue']);
 assert.equal((nav.match(/<svg /g)||[]).length,3);
 assert.match(script,/byId\('ownerAuth'\)\.hidden=true/);
 assert.doesNotMatch(html,/id="ownerTabNew"|id="ownerTabOld"|id="ownerTabCatalogue"/);
});

test('customer card contains clear identity, contact, role, status, address, disclosure and real actions',()=>{
 for(const token of [
  'crm-card-summary','crm-card-identity','crm-card-metadata','crm-card-open-label',
  'crm-card-expanded','crm-card-details','crm-card-actions','crm-avatar',
  'crm-status-active','crm-status-pending','crm-status-paused','crm-status-removed',
  'crmStageFilters','crmOldFilters','crmOldFilter','crmFilter'
 ])assert.ok(html.includes(token),token);
 assert.match(script,/function buildCustomerCard\(record,/);
 assert.match(script,/const item=make\('details',null,'crm-entry crm-customer-card/);
 assert.match(script,/cardContact\(record\.phone/);
 assert.match(script,/cardContact\(record\.email/);
 assert.match(script,/record\.address\|\|'Chưa cập nhật'/);
 assert.match(script,/accountLifecycleControls\(x\)/);
 assert.match(script,/leadLifecycleControls\(x\)/);
 assert.match(script,/openCustomerInspector\(x,body,item\)/);
 assert.match(script,/byId\('crmInspectorHome'\)/);
 assert.match(script,/typeLabel\(record\.requestedType\)/);
 assert.doesNotMatch(script,/nguyet@example\.com|treky@example\.com/);
});

test('new Gmail and historical leads are separate, search and status chips grounded in live records',()=>{
 assert.match(script,/const registered=customerRecord\.registered/);
 assert.match(script,/const leads=customerRecord\.leads/);
 assert.match(script,/customerRecord\.leads=data\.leads/);
 assert.match(script,/customerRecord\.registered=data\.registered/);
 assert.match(script,/byId\('crmOldFilter'\)\.value/);
 assert.match(script,/selectedOldFilter='all'/);
 assert.match(script,/selectedOwnerGroup=null/);
 assert.match(script,/if\(!selectedOwnerGroup\)/);
 assert.match(script,/const oldFilters=\[/);
 assert.doesNotMatch(script,/new Date\('2026-10-29'\)|fakeCustomerData/);
 assert.doesNotThrow(()=>new vm.Script(script));
});