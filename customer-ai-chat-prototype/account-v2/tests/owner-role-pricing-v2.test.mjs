import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateOwnerRolePricing} from '../customer-management.mjs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const owner=source('owner-catalogue.html'),app=source('app.html');
const backend=source('customer-backend.mjs'),router=source('router.mjs');
const good={confirmed:true,expectedRevision:3,requestedType:'collaborator',
 discountBps:2000,collaboratorBps:3500};

test('Admin can assign retail, agency or CTV without accepting invalid tiered discounts',()=>{
 assert.deepEqual(validateOwnerRolePricing(good),{requestedType:good.requestedType,expectedRevision:good.expectedRevision,discountBps:good.discountBps,collaboratorBps:good.collaboratorBps});
 for(const role of ['retail','agency']){
  const result=validateOwnerRolePricing({...good,requestedType:role,collaboratorBps:null});
  assert.equal(result.requestedType,role);
  assert.equal(result.collaboratorBps,null);
 }
 assert.throws(()=>validateOwnerRolePricing({...good,confirmed:false}),/OWNER_CONFIRMATION_REQUIRED/);
 assert.throws(()=>validateOwnerRolePricing({...good,expectedRevision:0}),/CUSTOMER_REVISION_REQUIRED/);
 assert.throws(()=>validateOwnerRolePricing({...good,requestedType:'admin'}),/CUSTOMER_ROLE_INVALID/);
 assert.throws(()=>validateOwnerRolePricing({...good,discountBps:3501}),/CTV_RATE_MUST_BE_AT_LEAST_CUSTOMER_RATE/);
 assert.throws(()=>validateOwnerRolePricing({...good,collaboratorBps:10001}),/CTV_RATE_MUST_BE_AT_LEAST_CUSTOMER_RATE/);
 assert.throws(()=>validateOwnerRolePricing({...good,requestedType:'agency'}),/CTV_ROLE_REQUIRED/);
 assert.throws(()=>validateOwnerRolePricing({...good,discountBps:-1}),/CUSTOMER_DISCOUNT_INVALID/);
});

test('Verified active account role change has owner checks, single-invoice policies and preserves history',()=>{
 assert.match(router,/pathname==='\/api\/v2\/admin\/customer-role'&&req\.method==='PATCH'/);
 assert.match(router,/owner\(actor\);send\(res,200,await adminAssignCustomerRole\(pool,actor,await json\(req\)\)\)/);
 assert.match(backend,/export async function adminAssignCustomerRole/);
 for(const code of ['OWNER_CANNOT_BE_MODIFIED','CUSTOMER_MUST_BE_ACTIVE_FOR_ROLE_CHANGE',
  'CUSTOMER_REVISION_CONFLICT','CTV_CLIENT_DISCOUNT_EXCEEDS_NEW_RATE'])
  assert.ok(backend.includes(code),code);
 assert.match(backend,/await applyGeneralDiscount\(c,profile\.id,owner\.google_sub,price\.discountBps,price\.collaboratorBps\)/);
 assert.match(backend,/SET type=\$2,revision=revision\+1/);
 assert.match(backend,/CUSTOMER_ROLE_PRICE_CHANGED/);
 assert.match(backend,/scopedPoliciesPreserved:scoped\.rows\.length,oneInvoice:true/);
 assert.doesNotMatch(backend,/DELETE FROM satori_v2_(?:orders|invoices|quotes)/);
});

test('Owner uses only three icon tabs and expanded cards provide role/commission editor',()=>{
 const nav=owner.match(/<nav id="ownerTabs"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.equal((owner.match(/id="ownerTabs"/g)||[]).length,1);
 assert.equal((nav.match(/data-owner-tab=/g)||[]).length,3);
 assert.equal((nav.match(/<svg /g)||[]).length,3);
 assert.match(owner,/function rolePricingEditor\(account,body,item/);
 assert.match(owner,/body\.append\(rolePricingEditor\(x,body,item\)\)/);
 assert.match(owner,/rolePricingEditor\(registeredAccount,body,item,\{old:true\}\)/);
 assert.match(owner,/crmRoleChoices\(role\)/);
 assert.match(owner,/openCustomerInspector\(registeredAccount,body,item\)/);
 assert.match(owner,/\/api\/v2\/admin\/customer-role/);
 assert.doesNotThrow(()=>new vm.Script(owner.match(/<script>([\s\S]*?)<\/script>/)?.[1]||''));
});

test('Gemini CTV delivery supports old/new client prices in a compact address picker',()=>{
 for(const key of ['ctvClientPanel','ctvExistingTab','ctvNewTab','ctvCustomerDiscount',
  'ctvCustomerDiscountField','address-ctv-discount'])assert.ok(app.includes(key),key);
 assert.match(app,/CTV được chỉnh/);
 assert.match(app,/ctvClientData\.clients\.find/);
 assert.match(app,/expectedPolicyVersion:customer\.policyVersion/);
 assert.match(app,/\/api\/v2\/ctv\/clients/);
 assert.doesNotThrow(()=>new vm.Script(app.match(/<script>([\s\S]*?)<\/script>/)?.[1]||''));
});
