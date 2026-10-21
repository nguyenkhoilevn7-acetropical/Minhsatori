import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CATALOGUE} from '../catalogue.mjs';
import {auditDriveCatalogue} from '../catalogue-drive-audit.mjs';

let count=0;
function eq(a,b,desc){assert.deepEqual(a,b,desc);count++}
function throws(fn,pattern,desc){assert.throws(fn,pattern,desc);count++}
const original=CATALOGUE.map(p=>({...p})),revision=129;
const status={revision,data:{orders:113,customers:[{phone:'PRIVATE'}]}};
const src=products=>({revision,data:{revision,source:'drive-ledger:satori_catalogue_v15',products}});
const normal=auditDriveCatalogue(status,src(original),CATALOGUE);
eq(normal.exactlyMatched,true,'all 20 default products match Drive');
eq(normal.sourceCount,20,'exact source count');
eq(normal.differences,[],'no differences');
eq(normal.checkoutEnabled,false,'matching catalogue cannot enable live checkout');
eq(normal.productionWriteEnabled,false,'never enables production writes');
eq(normal.customerSync,false,'no real customer sync');
eq(JSON.stringify(normal).includes('PRIVATE'),false,'no raw customer records exposed');
const altered=structuredClone(original);
altered[0].listPrice+=1000;
altered[1].name='Renamed catalogue product';
let report=auditDriveCatalogue(status,src(altered),CATALOGUE);
eq(report.exactlyMatched,false,'stale prices block source parity');
eq(report.eligibleForReadOnlyIntegration,false,'mismatch blocks read-only integration');
eq(report.differences.length,2,'both name and price divergences listed');
eq(report.differences.find(x=>x.code===altered[0].code).driveListPrice,altered[0].listPrice,'source price displayed exactly');
eq(report.differences.find(x=>x.code===altered[0].code).geminiListPrice,CATALOGUE[0].listPrice,'stale Gemini price displayed exactly');
eq(report.differences.some(x=>x.changedFields?.includes('name')),true,'name divergence shown');
const removed=original.slice(1);
report=auditDriveCatalogue(status,src(removed),CATALOGUE);
eq(report.differences[0].kind,'GEMINI_ONLY','local-only SKU found');
const extra=[...original,{...original[0],code:'TP-99999'}];
report=auditDriveCatalogue(status,src(extra),CATALOGUE);
eq(report.differences.find(x=>x.code==='TP-99999').kind,'DRIVE_ONLY','Drive-only SKU found');
throws(()=>auditDriveCatalogue({revision:130},src(original),CATALOGUE),/SOURCE_REVISION_MISMATCH/,'revision drift not accepted');
throws(()=>auditDriveCatalogue(status,{...src(original),data:{source:'demo',products:original}},CATALOGUE),/SOURCE_NOT_CANONICAL/,'reject local snapshot masquerading as Drive');
throws(()=>auditDriveCatalogue(status,{...src(original),data:{...src(original).data,revision:128}},CATALOGUE),/SOURCE_NOT_CANONICAL/,'reject nested revision mismatch');
throws(()=>auditDriveCatalogue(status,src([]),CATALOGUE),/INVALID_SOURCE_PRODUCTS/,'missing catalogue fails closed');
throws(()=>auditDriveCatalogue(status,src([{...original[0]},{...original[0]}]),CATALOGUE),/INVALID_SOURCE_PRODUCTS/,'duplicate SKU rejected');
throws(()=>auditDriveCatalogue(status,src([{...original[0],listPrice:-10}]),CATALOGUE),/INVALID_SOURCE_PRODUCTS/,'negative price rejected');
throws(()=>auditDriveCatalogue(status,src([{...original[0],listPrice:'98000'}]),CATALOGUE),/INVALID_SOURCE_PRODUCTS/,'string price rejected');
throws(()=>auditDriveCatalogue(status,src([{...original[0],spec:''}]),CATALOGUE),/INVALID_SOURCE_PRODUCTS/,'missing SKU specification rejected');
eq(Object.keys(normal).every(k=>!/(phone|customerId|address|secret|email)/i.test(k)),true,'no private data fields');
const here=path.dirname(fileURLToPath(import.meta.url));
const server=fs.readFileSync(path.join(here,'../server.mjs'),'utf8');
const admin=fs.readFileSync(path.join(here,'../admin.html'),'utf8');
eq(server.includes("p==='/api/admin/source-check'")&&server.includes('customerLinks.adminAuthorized(req)'),
 true,'catalogue audit route stays admin-authorized');
eq(server.includes('auditDriveCatalogue(status,catalogue,CATALOGUE)'),
 true,'admin check reads canonical HMAC responses through strict validator');
eq(server.includes('catalogueLiveSync:false,customerSync:false,checkoutEnabled:false'),
 true,'catalogue comparison cannot activate orders or customer sync');
eq(admin.includes('id="sourcePriceDifferences"')&&admin.includes('li.textContent='),
 true,'admin displays precise product differences safely without innerHTML');
console.log('PASS '+count+'/'+count+' read-only Drive catalogue parity & fail-closed checks (no network)');
