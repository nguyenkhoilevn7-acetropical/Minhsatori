import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateCustomerProfile} from '../customer-management.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const router=read('router.mjs'),backend=read('customer-backend.mjs');
const owner=read('owner-catalogue.html'),gemini=read('app.html');
const migration=read('migrations/20261025_customer_crm.sql');

const example={fullName:'CTV Example',phone:'0900000000',
 address:'123 Test Street',requestedType:'collaborator'};
test('admin sets separate customer default and CTV ceilings (percent in basis points)',()=>{
 const x=validateCustomerProfile({...example,discountBps:2000,collaboratorBps:3500},{admin:true});
 assert.equal(x.discountBps,2000);assert.equal(x.collaboratorBps,3500);
 assert.throws(()=>validateCustomerProfile({...example,discountBps:2000,collaboratorBps:1999},{admin:true}),/CTV_RATE_MUST_BE_AT_LEAST_CUSTOMER_RATE/);
 assert.throws(()=>validateCustomerProfile({...example,discountBps:2000,collaboratorBps:10001},{admin:true}),/CTV_RATE_MUST_BE_AT_LEAST_CUSTOMER_RATE/);
 assert.throws(()=>validateCustomerProfile({...example,requestedType:'retail',discountBps:2000,collaboratorBps:3500},{admin:true}),/CTV_ROLE_REQUIRED/);
});
test('legacy CTV policy is durably staged and activated with both rates, no second invoice',()=>{
 assert.match(migration,/collaborator_bps integer NULL/);
 assert.match(migration,/ADD COLUMN IF NOT EXISTS collaborator_bps/);
 assert.match(backend,/collaborator_bps AS "collaboratorBps"/);
 assert.match(backend,/CTV_RATE_REQUIRED_BEFORE_ACTIVATION/);
 assert.match(backend,/CTV_USE_LEGACY_ACTIVATION/);
 assert.match(backend,/data.requestedType==='collaborator'\?data.collaboratorBps:null/);
 assert.match(backend,/applyGeneralDiscount\(c,profileId,owner.google_sub,data.discountBps/);
 assert.match(owner,/const cap=field\('CK CTV/);
 assert.match(owner,/Chiết khấu CTV \(%\)/);
 assert.match(owner,/collaboratorBps=collaboratorBps/);
});
test('CTV per-client endpoint refuses cross-account, non-CTV, bad rate, stale writes and owner policy overrides',()=>{
 for(const x of [
  'CTV_PROFILE_FORBIDDEN','CTV_BASE_POLICY_NOT_APPROVED',
  'CTV_CUSTOMER_RATE_OUT_OF_RANGE','CTV_CLIENT_REVISION_CONFLICT',
  'CTV_OWNER_POLICY_LOCKED','CTV_CONFIRMATION_REQUIRED',
  'CTV_CLIENT_CREATED','CTV_CLIENT_RATE_UPDATED'
 ])assert.ok(router.includes(x),x);
 assert.match(router,/WHERE id=\$1 AND account_id=\$2 FOR UPDATE/);
 assert.match(router,/input\.discountBps<=base\.collaborator_bps/);
 assert.match(router,/approved_by/);
 assert.match(router,/expectedPolicyVersion/);
 assert.match(router,/invoiceMode:'single'/);
 assert.match(router,/WHERE profile_id=\$1 AND address_id=\$2 AND product_code IS NULL/);
 for(const method of ['GET','POST','PATCH'])
  assert.ok(router.includes("pathname==='/api/v2/ctv/clients'&&req.method==='"+method+"'"));
 assert.doesNotMatch(router,/\/api\/v2\/ctv\/clients'&&req\.method==='DELETE'/);
});
test('Gemini hides CTV controls on non-CTV account and supports old/new customer rates',()=>{
 for(const x of ['ctvClientPanel','ctvExistingTab','ctvNewTab',
  'ctvCustomerDiscountField','ctvCustomerDiscount','ctvClientList',
  'ctvCustomerLimit','saveNewAddress'])
 assert.match(gemini,new RegExp('id="'+x+'"'));
 assert.match(gemini,/profile\.type==='collaborator'|p\.type==='collaborator'/);
 assert.match(gemini,/ctvClientData\.collaboratorBps/);
 assert.match(gemini,/ctvCustomerTab='new'/);
 assert.match(gemini,/activateCtvClientTab\('old'\)/);
 assert.match(gemini,/activateCtvClientTab\('new'\)/);
 assert.match(gemini,/expectedPolicyVersion:customer\.policyVersion/);
 assert.match(gemini,/\/api\/v2\/ctv\/clients/);
 assert.match(gemini,/resetTestQuote\(\);invalidateCartPricing\(\)/);
 for(const match of gemini.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  assert.doesNotThrow(()=>new vm.Script(match[1]));
});
test('single icon tab-row in owner and only one independent legacy editor',()=>{
 const nav=owner.match(/<nav id="ownerTabs"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.equal((owner.match(/id="ownerTabs"/g)||[]).length,1);
 assert.equal((nav.match(/data-owner-tab=/g)||[]).length,3);
 assert.equal((nav.match(/<svg /g)||[]).length,3);
 assert.match(owner,/id="crmOldFilter"/);
 assert.match(owner,/function legacyBindingPanel\(/);
 assert.doesNotMatch(owner,/id="legacyCtvDiscount"/);
 assert.match(owner,/role\.onchange=syncRole/);
 assert.doesNotThrow(()=>new vm.Script(owner.match(/<script>([\s\S]*?)<\/script>/)?.[1]||''));
});