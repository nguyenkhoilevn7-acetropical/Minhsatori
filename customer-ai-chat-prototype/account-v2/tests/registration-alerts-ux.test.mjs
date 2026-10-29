import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');
test('owner CRM divides pending, reviewed-for-pricing, active and suspended',()=>{
 assert.match(script,/state:'pending'/);
 assert.match(script,/state:'reviewed'/);
 assert.match(script,/state:'active'/);
 assert.match(script,/state:'inactive'/);
 assert.match(script,/x\.approvedForPricing/);
 assert.match(script,/await loadCustomers\(\)/);
});
test('notification source is owner-only and excludes reviewed accounts',()=>{
 assert.match(router,/pathname==='\/api\/v2\/admin\/notifications'&&req\.method==='GET'/);
 assert.match(router,/owner\(actor\);send\(res,200,await adminRegistrationNotifications\(pool\)\)/);
 assert.match(backend,/a\.access_status='PENDING' AND r\.reviewed_at IS NULL/);
 assert.match(backend,/ORDER BY r\.submitted_at DESC/);
 assert.match(backend,/CUSTOMER_REGISTRATION_SUBMITTED/);
});
test('website has badge, notification bell and opt-in sound, without duplicate initial alert',()=>{
 assert.match(html,/id="crmBellCount"/);
 assert.match(html,/id="crmSoundToggle"/);
 assert.match(script,/ownerNotificationKnown\?data\.newest\.filter/);
 assert.match(script,/playRegistrationBell\(\)/);
 assert.match(script,/setRegistrationBadge\(data\.pendingCount\)/);
 assert.match(script,/window\.setInterval/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
test('one account-bound invoice selector uses exact source refs and never reimports',()=>{
 assert.doesNotMatch(html,/id="legacySelectAll"/);
 assert.match(html,/id="crmLegacyLink"/);
 assert.match(script,/checkbox\.dataset\.refs=JSON\.stringify\(group\.refs\)/);
 assert.match(script,/sourceRevision:source\.revision,refs:list/);
 assert.match(backend,/legacyPhoneCandidate\(o\.phone\)/);
});

test('CTV fields use separate client and partner rates and show margin',()=>{
 assert.match(html,/id="crmCtvRate"/);
 assert.match(html,/id="crmCtvProfit"/);
 assert.match(script,/isCtv\?\{collaboratorBps:ctvBps\}/);
 assert.match(script,/ctvBps<bps/);
 assert.match(script,/CTV phải có chiết khấu riêng/);
 assert.match(script,/CK CTV:.*pct\(row\.collaboratorBps\)/);
});
