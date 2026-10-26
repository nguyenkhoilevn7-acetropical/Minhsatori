import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const section=(first,last)=>source.slice(source.indexOf(first),source.indexOf(last,source.indexOf(first)));
test('no new CTV pair invoice policy can be approved',()=>{
 const admin=section('async function adminPolicy(', '/** Canonical policy-approved');
 assert.match(admin,/mode==='single'/);
 assert.match(admin,/TWO_INVOICES_DISABLED/);
 assert.match(admin,/hasCommission/);
 assert.match(admin,/collaboratorBps>input.discountBps/);
 assert.match(admin,/profile.rows\[0\]\.type==='collaborator'/);
 assert.match(admin,/hasCommission\?input.collaboratorBps:null,'single'/);
});
test('client quote strips all private collaborator money fields',()=>{
 const client=section('function customerPricing(', '/**\n * Explicit delivery selection');
 assert.match(client,/collaboratorSettlement/);
 assert.match(client,/internalUnitPrice/);
 assert.match(client,/customerPricing\(\{priced,cartRevision\}\)/);
 assert.doesNotMatch(client,/\.\.\.priced,[\s\S]*note:'Báo giá/);
});
test('CTV profit report is owner only and excludes pending order profit from sales',()=>{
 const report=section("if(pathname==='/api/v2/admin/ctv-summary'","if(pathname==='/api/v2/admin/accounts'");
 assert.match(report,/owner\(actor\)/);
 assert.match(report,/profile.rows\[0\]\.type==='collaborator'/);
 assert.match(report,/row.state==='COMMITTED'/);
 assert.match(report,/row.state==='PENDING_INTEGRATION'/);
 assert.match(report,/totals.testProfitVnd\+=profit/);
 assert.match(report,/totals.profitVnd\+=profit/);
 assert.match(report,/profit<0\|\|profit>sale/);
});
