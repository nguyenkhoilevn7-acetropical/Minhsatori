import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {groupHistoricalAddresses} from '../legacy-address-dedupe.mjs';

const owner=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const gemini=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const ownerScript=owner.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const geminiScript=[...gemini.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
 .map(m=>m[1]).find(Boolean);

test('three owner tabs remain, exactly one CRM Gmail/history linking panel',()=>{
 assert.equal((owner.match(/id="ownerTabs"/g)||[]).length,1);
 for(const tab of ['new','old','catalogue'])
  assert.match(owner,new RegExp('data-owner-tab="'+tab+'"'));
 assert.match(ownerScript,/activateOwnerTab\(tab\)/);
 assert.match(ownerScript,/function legacyBindingPanel\(/);
 assert.equal((owner.match(/id="crmLegacyLink"/g)||[]).length,1);
 assert.match(ownerScript,/lead\.id='crmLegacyLeadSelect'/);
 assert.match(ownerScript,/byId\('crmLegacyLink'\)\.replaceChildren\(legacyBindingPanel\(\)\)/);
 for(const removed of ['crmLedgerDiscovery','crmLedgerPreview','legacyLedgerDisclosure','legacySearchForm'])
  assert.doesNotMatch(owner,new RegExp('id="'+removed+'"'));
 assert.doesNotMatch(ownerScript,/renderLegacyRecipientDirectory\(/);
 assert.doesNotMatch(ownerScript,/submitLegacyImport\(/);
 assert.doesNotThrow(()=>new vm.Script(ownerScript));
});

test('owner-saved old lead stays visible even when same Gmail registered in Google V2',()=>{
 assert.match(ownerScript,/leads\.filter\(l=>!l\.linkedAccountId\|\|/);
 assert.doesNotMatch(ownerScript,/!registered\.some\(a=>[\s\S]*a\.email&&l\.email/);
 assert.match(ownerScript,/select\.dispatchEvent\(new Event\('change'\)\)/);
 assert.match(ownerScript,/x\.email\?\.toLowerCase\(\)===item\.email\.toLowerCase\(\)/);
});

test('one owner action activates saved verified Gmail or attaches exact invoice history',()=>{
 assert.match(router,/pathname==='\/api\/v2\/admin\/legacy\/activate-saved'/);
 assert.match(router,/ownerActivateSavedGmail\(pool,actor,await json\(req\)\)/);
 assert.match(backend,/export async function ownerActivateSavedGmail\(/);
 assert.match(backend,/CUSTOMER_LEAD_CREATED','LEGACY_CRM_STAGED'/);
 assert.match(backend,/EXISTING_POLICY_REQUIRES_OWNER/);
 assert.match(ownerScript,/\/api\/v2\/admin\/legacy\/activate-saved','POST'/);
 assert.match(ownerScript,/\/api\/v2\/admin\/legacy\/bind-history','POST'/);
 assert.match(ownerScript,/leadId:item\.id/);
 assert.doesNotMatch(ownerScript,/LEGACY_INVOICE_ALREADY_IMPORTED/);
});

test('CTV role, discount and delivery editors still use account-scoped APIs',()=>{
 assert.match(ownerScript,/crmRoleChoices\(role\)/);
 assert.match(ownerScript,/function rolePricingEditor\(/);
 assert.match(ownerScript,/Chiết khấu mặc định cho khách của CTV/);
 assert.match(ownerScript,/ctvRate<customerRate/);
 assert.match(ownerScript,/\/api\/v2\/admin\/customer-role','PATCH'/);
 assert.match(ownerScript,/\/api\/v2\/admin\/policies','POST'/);
 assert.match(ownerScript,/renderOwnerCtvClientCards\(account,clients\)/);
 assert.match(ownerScript,/crmUniqueSavedAddressGroups\(a\.addresses\)/);
 assert.match(ownerScript,/ownerAddressEditor\(profile\.id,row,customerEpoch,refresh\)/);
 assert.match(ownerScript,/input\.disabled=!row\.active\|\|!hasApprovedCap/);
 assert.match(ownerScript,/changeAccountLifecycle\(account,'SUSPENDED'\)/);
 assert.match(ownerScript,/changeAccountLifecycle\(account,'REMOVED'\)/);
});

test('historical source invoice ID remains distinct; addresses dedupe by location and latest time',()=>{
 assert.match(ownerScript,/checkbox\.dataset\.refs=JSON\.stringify\(group\.refs\)/);
 assert.match(ownerScript,/sourceRevision:source\.revision,refs:list/);
 assert.match(backend,/LEGACY_INVOICE_ALREADY_OWNED/);
 assert.match(backend,/CRM_APPROVED_PROFILE_MISMATCH/);
 const invoices=Array.from({length:7},(_,i)=>({
  invoiceNo:8000+i,address:i%2?'42 Đường Số 95, Cát Lái':'42 Duong So 95 Cat Lai',
  date:String(i+1).padStart(2,'0')+'/10/2026',name:'Recipient '+i
 }));
 const locations=groupHistoricalAddresses(invoices);
 assert.equal(locations.length,1);
 assert.equal(locations[0].invoiceNo,8006);
 assert.equal(invoices.length,7);
});

test('Gemini ordering, CTV sheet and single-invoice behavior survive CRM cleanup',()=>{
 assert.equal((gemini.match(/id="ctvCustomerDialog"/g)||[]).length,1);
 assert.match(gemini,/id="ctvSheetSave"/);
 assert.match(gemini,/id="ctvExistingTab"/);
 assert.match(gemini,/id="ctvNewTab"/);
 assert.match(geminiScript,/function openCtvSheet\(/);
 assert.match(geminiScript,/\/api\/v2\/ctv\/clients/);
 assert.match(geminiScript,/discountBps>ctvClientData\.collaboratorBps/);
 assert.match(geminiScript,/function closeCtvSheet\(/);
 assert.match(geminiScript,/rememberDeliveryRequest\(\{deliveryNote,requestedDeliveryAt:null\}\)/);
 assert.match(ownerScript,/invoiceMode:'single'/);
 assert.doesNotThrow(()=>new vm.Script(geminiScript));
});
