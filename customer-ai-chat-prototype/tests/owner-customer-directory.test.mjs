import assert from 'node:assert/strict';
import {directoryFromInvoices,detailFromEvidence,directoryKey} from '../owner-customer-directory.mjs';
const rows=[
 {name:'Hà Minh Nguyệt',phone:'0901000001',location:'Q1',invoiceNo:1},
 {name:'Ha Minh Nguyet',phone:'0901000001',location:'Q2',invoiceNo:2},
 {name:'Traky Sài Gòn',phone:'0902000001',location:'Sài Gòn',invoiceNo:3},
 {name:'Traky Hair',phone:'0902000002',location:'Cần Thơ',invoiceNo:4},
 {name:'Hà Minh Nguyệt khác',phone:'0903000001',location:'Không được gộp',invoiceNo:5}
];
const dir=directoryFromInvoices(rows);
assert.equal(dir.length,3);
assert.equal(dir.find(x=>x.key===directoryKey('Hà Minh Nguyệt')).aliases.length,2);
assert.equal(dir.find(x=>x.key==='brand:traky').invoiceCount,2);
assert.notEqual(directoryKey('Tracy Hair'),directoryKey('Traky Hair'),'do not merge Tracy and Traky without owner confirmation');
const hm=detailFromEvidence('Hà Minh Nguyệt',rows,[],{sourceTotal:2});
assert.equal(hm.places.length,2);assert.equal(hm.complete,true);
assert.ok(hm.places.every(p=>p.address!=='Không được gộp'));
const traky=detailFromEvidence('Traky',rows,[],{sourceTotal:31});
assert.equal(traky.places.length,2);assert.equal(traky.complete,false);
assert.equal(traky.needsReview,true);
assert.equal(traky.multipleContacts,true);
assert.equal(traky.canIssueRealLinks,false);
const more=detailFromEvidence('Hà Minh Nguyệt',[rows[0]], [rows[1]], {sourceTotal:2});
assert.equal(more.places.length,2);assert.equal(more.complete,true);
const duplicate=detailFromEvidence('Hà Minh Nguyệt',[rows[0]], [rows[0]], {sourceTotal:1});
assert.equal(duplicate.count,1);
const incomplete=detailFromEvidence('Hà Minh Nguyệt',rows,[],{sourceTotal:2,invoicesIncomplete:true});
assert.equal(incomplete.complete,false);
console.log('PASS owner directory: name grouping, unique destinations, source coverage, no production links');

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html=readFileSync(path.join(root,'admin.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'must have inline admin controller');
new vm.Script(script,{filename:'admin.html.js'}); // Reject Samsung browser syntax errors.
assert.match(html,/\/api\/admin\/customer-directory\?mode=list/);
assert.match(html,/\/api\/admin\/customer-directory\?mode=detail/);
assert.match(html,/if\(selectedRealKey\)/,'prevent sending real identity to sandbox');
assert.match(html,/realCustomerLinkWarning/);
const server=readFileSync(path.join(root,'server.mjs'),'utf8');
const start=server.indexOf("p==='/api/admin/customer-directory'");
const end=server.indexOf('// This route probes source-of-truth',start);
assert.ok(start>0&&end>start);
const endpoint=server.slice(start,end);
assert.match(endpoint,/customerLinks\.adminAuthorized\(req\)/);
assert.match(endpoint,/readOnlyReady\(\)/);
assert.match(endpoint,/readMinhSatori\('customers.search'/);
assert.match(endpoint,/readMinhSatori\(l.action,l.payload\)/);
assert.doesNotMatch(endpoint,/orders\.create|payments\.markCustomerPaid|saveOrdersAtomic|customerLinks\.restoreState|customerLinks\.handleAdmin/);
console.log('PASS browser JavaScript syntax and admin-only/no-write boundary');

const reviewHtml=html;
assert.match(reviewHtml,/id="saveRealReview"[^>]+type="button"|id="saveRealReview" type="button"/);
assert.match(reviewHtml,/\$\('addCustomerLocation'\)\.disabled=false/);
assert.match(reviewHtml,/function appendNewCustomerLocation\(initial=\{\}\)/);
assert.match(reviewHtml,/data-imported-locations/);
assert.match(reviewHtml,/data-manual-location/);
assert.match(reviewHtml,/realReviewDrafts\.set\(selectedRealKey,data\)/);
assert.match(reviewHtml,/function saveRealReviewDraft\(\)/);
assert.match(reviewHtml,/realPricingEvidence/);
assert.match(reviewHtml,/\$\('discount'\)\.value=String\(evidence\.suggestedDiscount\)/);
assert.doesNotMatch(reviewHtml,/for\(const id of \['discount','ship','vatRate'\]\)\$\(id\)\.disabled=enabled/);
assert.match(reviewHtml,/if\(selectedRealKey\)\{\$\('error'\)\.textContent='Khách thật chỉ được đối chiếu/);
assert.doesNotMatch(reviewHtml,/localStorage\.setItem|sessionStorage\.setItem/,'no PII stored by browser');
const pricingServer=readFileSync(path.join(root,'server.mjs'),'utf8');
assert.match(pricingServer,/observedRealCustomerDiscounts\(invoiceRows,name\)/);
assert.match(pricingServer,/pricingEvidence,realCustomerLinkIssuanceEnabled:false/);
const details=pricingServer.slice(start,end);
assert.doesNotMatch(details,/orders\.create|payments\.markCustomerPaid|writeState/);
console.log('PASS real customer form: editable VAT/ship/discount, add-address, session-only drafts, no real checkout');
