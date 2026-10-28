import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const backend=fs.readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');

test('one owner-only backoffice shows catalogue, verified registrations and old unlinked customers',()=>{
 assert.match(html,/id="console"/);
 assert.match(html,/id="crmConsole" hidden/);
 assert.match(html,/if\(!me\?\.account\?\.isAdmin\)throw Error\('ADMIN_REQUIRED'\)/);
 assert.match(html,/byId\('crmConsole'\)\.hidden=false/);
 assert.match(html,/data\.registered/);
 assert.match(html,/data\.leads/);
 assert.match(html,/\/api\/v2\/admin\/customers/);
 assert.match(backend,/satori_v2_customer_leads/);
 assert.match(backend,/satori_v2_registrations/);
});
test("registered customer's complete V2 profile and address records are owner scoped",()=>{
 for(const part of [
  '/api/v2/admin/profiles?accountId=',
  '/api/v2/admin/addresses?profileId=',
  '/api/v2/admin/policies?profileId='
 ])assert.ok(html.includes(part));
 assert.match(html,/api\(\'\/api\/v2\/me\'\)/);
 assert.match(html,/credentials:'same-origin'/);
 assert.match(html,/headers\['x-satori-csrf'\]=csrf\(\)/);
 assert.match(router,/owner\(actor\);/);
 assert.match(html,/entry\.append\(make\('strong',/);
 assert.doesNotMatch(html,/innerHTML\s*=|localStorage|sessionStorage/);
});
test('owner-only financial policy requires explicit approval and backend scope/version; Gemini never owns price',()=>{
 assert.match(html,/if\(!confirm\(msg\)\)return/);
 assert.match(html,/invoiceMode:'single',discountBps:bps/);
 assert.match(html,/await api\('\/api\/v2\/admin\/policies','POST'/);
 assert.match(router,/async function adminPolicy\(pool,actor,input\)/);
 assert.match(router,/owner\(actor\);\s*error\(input\.confirmed===true/);
 assert.match(router,/SELECT COALESCE\(MAX\(version\),0\)\+1 AS version FROM satori_v2_policies/);
 assert.match(router,/calculateQuote\(/);
 assert.match(html,/if\(!Number\.isFinite\(value\)/);
 assert.match(html,/Math\.abs\(value\*100-bps\)>1e-7/);
});
test('registration is Google-authenticated, owner-approved, no passwords collected or invoice writes',()=>{
 assert.match(html,/status:'ACTIVE',expectedRevision:x\.revision/);
 assert.match(backend,/VERIFIED_EMAIL_MISMATCH/);
 assert.match(backend,/customerStates|CUSTOMER_REGISTRATION_INCOMPLETE|CUSTOMER_LEAD_CREATED/);
 assert.doesNotMatch(html,/<input[^>]+type=["']password["']/);
 assert.doesNotMatch(html,/SATORI_BOT_SECRET|orders\.create|PDF_RENDER_SECRET/);
 assert.match(router,/REAL_CHECKOUT_GATE_NOT_VERIFIED/);
});

test('all inline owner admin JavaScript parses, even on a mobile browser',()=>{
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,'owner inline application exists');
 assert.doesNotThrow(()=>new vm.Script(script,{filename:'owner-catalogue.html'}));
});

test('review and pricing activation are separate, with no silent default zero percent',()=>{
 assert.match(router,/\/api\/v2\/admin\/customers\/approve/);
 assert.match(backend,/export async function adminApproveRegistration/);
 assert.match(backend,/CUSTOMER_APPROVAL_REQUIRED_BEFORE_PRICING/);
 assert.match(backend,/DISCOUNT_INPUT_REQUIRED_AFTER_APPROVAL/);
 assert.match(html,/\/api\/v2\/admin\/customers\/approve/);
 assert.match(html,/approvedForPricing/);
 assert.match(html,/Lưu chiết khấu & kích hoạt/);
 assert.doesNotMatch(html,/discountBps:0,confirmed:true/);
});
test('owner-only signed legacy lookup, Gmail binding, editable contact and multiple delivery points',()=>{
 assert.match(router,/owner\(actor\);\s*send\(res,200,await legacyCustomerSearch\(q\)\)/);
 assert.match(router,/legacyCustomerImport\(pool,actor/);
 assert.match(backend,/readMinhSatori\('orders.list'/);
 assert.match(backend,/LEGACY_OWNER_CONFIRMATION_REQUIRED/);
 assert.match(backend,/LEGACY_VERIFIED_GMAIL_MISMATCH/);
 assert.match(backend,/account.id!==owner.id/);
 assert.match(backend,/LEGACY_CRM_STAGED/);
 assert.match(backend,/LEGACY_CRM_ACTIVATED/);
 assert.match(html,/id="legacyQuery"/);
 assert.match(html,/legacyDeliveryRow/);
 assert.match(html,/ownerAddressEditor/);
 assert.match(html,/ownerContactEditor/);
 assert.match(html,/ownerIconShapes/);
});
