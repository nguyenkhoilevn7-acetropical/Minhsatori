import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const js=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const standalone=readFileSync(new URL('../standalone.mjs',import.meta.url),'utf8');

test('separate backend boots ONLY V2 endpoints',()=>{
 assert.match(standalone,/handleAccountV2\(req,res,pathname\)/);
 assert.match(standalone,/V2_ROUTE_ONLY/);
 assert.doesNotMatch(standalone,/from '\.\.\/server\.mjs'/);
 assert.match(standalone,/legacyRoutesDisabled:true/);
});
test('Admin backend explicitly excludes old invoice APIs and stores no password',()=>{
 assert.match(router,/adminCustomerList\(pool\)/);
 assert.match(router,/adminCreateLead\(pool,actor.id/);
 assert.match(router,/adminChangeCustomerStatus\(pool,actor/);
 assert.match(router,/adminLinkLead\(pool,actor/);
 assert.match(router,/CUSTOMER_PENDING_ADMIN_APPROVAL/);
 assert.doesNotMatch(router,/INSERT INTO .*password/i);
});
test('Admin lists registered fields, old customers and owner-approved discount, no password UI',()=>{
 for(const id of ['registeredCustomers','leadCustomers','crmAddCustomer','crmSearch',
  'reloadCustomers','customerRegistration','registrationStatus','registrationBox'])
  assert.match(html,new RegExp('id="'+id+'"'));
 for(const field of ['fullName','email','phone','address','companyName','taxCode',
  'requestedType','note'])
  assert.match(html,new RegExp('name="'+field+'"'));
 assert.doesNotMatch(html,/<input[^>]+type="password"/i);
 assert.match(js,/await call\('\/api\/v2\/admin\/customers'/);
 assert.match(js,/await call\('\/api\/v2\/register'/);
 assert.match(js,/manualIdentityVerified:!a\.email/);
 // CRM forms remain in an inactive template pending native-app management.
 assert.match(html,/#ownerPanel,#ownerOriginalInvoices\{display:none!important\}/);
 assert.match(js,/ownerPanel'\)\.hidden=true/);
 assert.doesNotMatch(js,/if\(me\.account\.isAdmin\)loadOwner\(\)/);
});
test('iOS V2 website JS remains parseable without browser globals',()=>{
 assert.ok(js);
 assert.doesNotThrow(()=>new vm.Script(js));
});
test('pending customer gate does not request catalog or show chat',()=>{
 assert.match(js,/const pending=!me\.account\.isAdmin&&me\.account\.accessStatus==='PENDING'/);
 assert.match(js,/if\(pending\)\{[\s\S]*?view\('account'\);return;/);
 assert.match(js,/const catalogue=await call\('\/api\/v2\/catalogue'/);
});
