import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const html=read('owner-catalogue.html');
const router=read('router.mjs');
const backend=read('customer-backend.mjs');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';

test('retire all one-tap Gmail/history links from old customer UI',()=>{
 for(const label of ['Liên kết Gmail & lịch sử · một thao tác',
  'Liên kết địa chỉ với Gmail','Đối chiếu & liên kết khi xác nhận đúng chủ',
  'Xác nhận liên kết & kích hoạt']){
  assert.equal(html.includes(label),false,label);
 }
 assert.doesNotMatch(html,/id="crmLegacyLink"/);
 assert.doesNotMatch(script,/function legacyBindingPanel\(/);
 assert.doesNotMatch(script,/crmLegacyLeadSelect|crmLegacyInvoiceFind/);
 assert.match(script,/async function loadLedgerMonthCustomers/);
 assert.match(script,/async function searchSignedOldCustomers/);
 assert.match(html,/id="crmSignedHistoryRows"/);
 assert.match(html,/id="crmSignedHistoryExactRows"/);
 assert.match(html,/id="crmImportDelivery"/);
 assert.doesNotThrow(()=>new vm.Script(script));
});

test('verified address importer remains owner-only and logically independent of legacy binding',()=>{
 assert.match(script,/function renderHistoricAddressImporter\(\)/);
 assert.match(script,/byId\('crmImportDeliveryBody'\)/);
 assert.match(script,/customerRecord\.registered\.filter/);
 assert.match(script,/\/api\/v2\/admin\/legacy\/search\?query=/);
 assert.match(script,/\/api\/v2\/admin\/legacy\/import-delivery-points','POST'/);
 assert.match(script,/sourceRevision:source\.revision/);
 assert.match(script,/expectedAccountRevision:account\.revision/);
 assert.match(script,/identityConfirmed:true/);
 const start=script.indexOf('function renderHistoricAddressImporter(){');
 const end=script.indexOf('async function searchSignedOldCustomers(){',start);
 const importer=script.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.doesNotMatch(importer,/\/api\/v2\/admin\/legacy\/bind-history|\/api\/v2\/admin\/legacy\/activate-saved/);
 assert.match(router,/if\(pathname==='\/api\/v2\/admin\/legacy\/import-delivery-points'&&req.method==='POST'\)\{\s*owner\(actor\)/);
 assert.match(backend,/export async function ownerImportHistoricDeliveryPoints\(/);
 assert.match(backend,/DELIVERY_POINTS_IMPORTED_FROM_SIGNED_LEDGER/);
 assert.match(backend,/invoiceHistoryImported:false/);
 assert.match(router,/pathname==='\/api\/v2\/admin\/customers\/approve'/);
 assert.match(router,/pathname==='\/api\/v2\/admin\/customer-role'/);
});

test('old binding endpoints retained for compatible reads but removed from new owner UI',()=>{
 assert.match(router,/pathname==='\/api\/v2\/admin\/legacy\/bind-history'/);
 assert.match(router,/pathname==='\/api\/v2\/admin\/legacy\/activate-saved'/);
 assert.doesNotMatch(script,/\/api\/v2\/admin\/legacy\/bind-history','POST'/);
 assert.doesNotMatch(script,/\/api\/v2\/admin\/legacy\/activate-saved','POST'/);
});
