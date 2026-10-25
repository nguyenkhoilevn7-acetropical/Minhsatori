import assert from 'node:assert/strict';
import {contactPhone} from '../contact-phone.mjs';
import {directoryFromInvoices,detailFromEvidence,directoryKey,physicalAddressKey} from '../owner-customer-directory.mjs';
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
assert.equal(more.places.length,2);assert.equal(more.complete,false,
 'sourceTotal describes source profiles; one historical invoice cannot prove every source profile has been scanned');
const duplicate=detailFromEvidence('Hà Minh Nguyệt',[rows[0]], [rows[0]], {sourceTotal:1});
assert.equal(duplicate.count,1);
const incomplete=detailFromEvidence('Hà Minh Nguyệt',rows,[],{sourceTotal:2,invoicesIncomplete:true});
assert.equal(incomplete.complete,false);
const repeatProfiles=Array.from({length:17},(_,i)=>({
 name:'Hà Minh Nguyệt',phone:i===1?'0358707777':i===11?'':'0901000001',
 location:'Số '+(i<2?1:i===11?10:i<11?i:i-1)+' Đường Thử, Q1',
 sourceInvoiceNo:i===10||i===11?68:100+i,
 ref:{id:10000+i,invoiceNo:i===10||i===11?68:100+i}
}));
const purchases=Array.from({length:10},(_,i)=>({
 name:'Hà Minh Nguyệt',phone:'0901000001',location:'Số 1 Đường Thử, Q1',
 invoiceNo:200+i,id:30000+i
}));
const grouped=detailFromEvidence('Hà Minh Nguyệt',repeatProfiles,purchases,{sourceTotal:17});
assert.equal(grouped.complete,true,'17 raw profile records may belong to fewer physical delivery locations');
assert.equal(grouped.sourceProfilesObserved,17);
assert.equal(grouped.places.length,15,'17 source profiles collapse to 15 actual delivery points');
const first=grouped.places.find(p=>p.address==='Số 1 Đường Thử, Q1');
assert.equal(first.purchaseCount,10,'ten purchases are separate invoices under one delivery point');
assert.equal(first.phones.length,2,'different contact numbers must not split one address');
assert.equal(first.invoiceNos.length,12);
assert.equal(first.needsReview,true,'different contact names/numbers may require owner review, not global block');
assert.equal(grouped.places.filter(x=>x.approvedCandidate).length,15,
 'review status must not disable other eligible locations');
const sameInvoiceDifferentRecords=grouped.places.flatMap(x=>x.references).filter(x=>x.invoiceNo===68);
assert.equal(sameInvoiceDifferentRecords.length,2,'two historical records with invoice #68 are preserved');
assert.ok(!grouped.canIssueRealLinks,'reading directory alone must never grant production write privilege');
console.log('PASS repeat-purchase domain rules: ten purchases, 17 raw profiles, 15 locations, duplicate #68, different phones');
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
assert.match(reviewHtml,/<button type="button" id="saveRealReview"/);
assert.match(reviewHtml,/\$\('addCustomerLocation'\)\.disabled=false/);
assert.match(reviewHtml,/function appendNewCustomerLocation\(initial=\{\}\)/);
assert.match(reviewHtml,/data-imported-locations/);
assert.match(reviewHtml,/data-manual-location/);
assert.match(reviewHtml,/realReviewDrafts\.set\(selectedRealKey,data\)/);
assert.match(reviewHtml,/function saveRealReviewDraft\(\)/);
assert.match(reviewHtml,/realPricingEvidence/);
assert.match(reviewHtml,/\$\('discount'\)\.value=String\(evidence\.suggestedDiscount\)/);
assert.doesNotMatch(reviewHtml,/for\(const id of \['discount','ship','vatRate'\]\)\$\(id\)\.disabled=enabled/);
assert.match(reviewHtml,/if\(selectedRealKey\)\{[\s\S]{0,200}cấp link khách THẬT từ bản sandbox/,'no fake link for real customers');
assert.doesNotMatch(reviewHtml,/localStorage\.setItem|sessionStorage\.setItem/,'no PII stored by browser');
const pricingServer=readFileSync(path.join(root,'server.mjs'),'utf8');
assert.match(pricingServer,/observedRealCustomerDiscounts\(invoiceRows,name\)/);
assert.match(pricingServer,/pricingEvidence,locationCandidates,locationIssues,/);
assert.match(pricingServer,/realCustomerLinkIssuanceEnabled:false/);
assert.match(pricingServer,/selectedLocationEvidence\(selected.places\)/,
 'real customer directory must return valid locations separately from review issues');
const details=pricingServer.slice(start,end);
assert.doesNotMatch(details,/orders\.create|payments\.markCustomerPaid|writeState/);
console.log('PASS real customer form: editable VAT/ship/discount, add-address, session-only drafts, no real checkout');

assert.match(reviewHtml,/class="customer-link-actions"/,'stack actions, no overlapping buttons');
assert.match(reviewHtml,/\.customer-link-actions\{display:grid;grid-template-columns:minmax\(0,1fr\);row-gap:12px/);
assert.match(reviewHtml,/id="createButton">🔗 Cấp link cho khách thử/);
assert.match(reviewHtml,/id="realLinkBlockReason"/);
assert.match(reviewHtml,/\$\('realLinkBlockReason'\)\.hidden=!enabled/);
assert.match(reviewHtml,/encodeURIComponent\(selectedCustomerId\)\+'\/rotate'/,'reissue only explicitly confirmed TEST links');
assert.match(reviewHtml,/Cấp LẠI link khách THỬ/,'reissue requires owner confirmation');
assert.match(reviewHtml,/if\(selectedRealKey\)\{[\s\S]{0,200}khách THẬT từ bản sandbox/);
assert.doesNotMatch(reviewHtml,/realCustomerPermission|canAddAddress|mayAddLocation|permissions\.grant/,'no dealer-address permission in this change');
console.log('PASS owner link: independent buttons, guarded TEST reissue and no customer-grant feature');

assert.match(reviewHtml,/id="realLinkCheck" hidden/,'separate actionable real link preflight');
assert.match(reviewHtml,/customerRef:\{id:sourceRow\.ref\.id,invoiceNo\}/,
 'single-location real links require exact record ID and invoice number');
assert.match(reviewHtml,/sourceRow\.phone,location:sourceRow\.address/,
 'real customer identity must come from the SAME source invoice row');
assert.match(reviewHtml,/realOriginalLocations\.length>1/,
 'multiple existing locations must go to owner-reviewed agency workflow');
assert.match(reviewHtml,/agencyRealFind'\)\.click\(\)/,
 'historical delivery locations can be loaded without recreating a customer');
assert.doesNotMatch(reviewHtml,/customerRef:\{invoiceNo\},name:/,
 'never issue a returning-customer link using invoice number alone');
assert.match(reviewHtml,/\$\('realLinkCheck'\)\.hidden=!enabled/);
assert.match(reviewHtml,/\$\('createButton'\)\.hidden=enabled/,'avoid invisible disabled real link button');
assert.match(reviewHtml,/function makeRealField\(labelText,value,index,field\)/);
const editable=reviewHtml.slice(reviewHtml.indexOf('function makeRealField('),reviewHtml.indexOf('function fillRealCustomer('));
assert.doesNotMatch(editable,/readOnly=true|tabIndex=-1/,'historical phone/address fields must be editable for owner');
assert.match(editable,/realEditingLocations\[index\]\[field\]=input.value/,'preserve reviewed edits');
assert.match(reviewHtml,/editedLocations\};/,'all historical destination edits survive as a draft');
assert.match(reviewHtml,/editedLocations\.filter\(/,'calculate which addresses changed');
assert.match(reviewHtml,/currentRealEvidence/,'price evidence remains visible');
assert.match(reviewHtml,/Không cấp link thử dưới tên khách thật/,'no misleading test links for production customers');
assert.doesNotMatch(reviewHtml,/grantDealer|allowCustomerAddLocation|customerMayAddAddress/,'no dealer permissions per owner instruction');
console.log('PASS owner editable historical delivery addresses and clear real-link gating without production writes');

const normalizedDelivery=detailFromEvidence('Hà Minh Nguyệt',[
 {name:'Hà Minh Nguyệt',location:'712 đường Vĩnh Khánh, Hồ Chí Minh — Giao sau 14:00',
  phone:'0768152072',ref:{id:1792803051601,invoiceNo:5936},sourceInvoiceNo:5936},
 {name:'Hà Minh Nguyệt',location:'712 Đ. Vĩnh Khánh, Khánh Hội, Hồ Chí Minh 72800',
  phone:'0358707777',ref:{id:81,invoiceNo:81},sourceInvoiceNo:81},
 {name:'Hà Minh Nguyệt',location:'Yến Hoả Quán - Đ. Vĩnh Khánh/402 HCMC, Quận 4',
  phone:'0919989887',ref:{id:64,invoiceNo:64},sourceInvoiceNo:64},
 {name:'Hà Minh Nguyệt',location:'42 Đ. Số 95, Cát Lái, Hồ Chí Minh.',
  phone:'0392598879',ref:{id:1792226691897,invoiceNo:5921},sourceInvoiceNo:5921},
 {name:'Hà Minh Nguyệt',location:'42 Đ. Số 95, Cát Lái, Hồ Chí Minh.',
  phone:'0358707777',ref:{id:1792135730343,invoiceNo:5918},sourceInvoiceNo:5918}
],[],{sourceTotal:5});
assert.equal(normalizedDelivery.places.length,3,
 '712 Vĩnh Khánh is one physical destination despite wording and delivery note');
const vk=normalizedDelivery.places.find(p=>p.invoiceNos.includes('5936'));
assert.equal(vk.references.length,2,'retain both historical invoice refs');
assert.equal(vk.sourceRows.length,2,'keep each original phone with its original invoice reference');
assert.notEqual(physicalAddressKey('712 Đ. Vĩnh Khánh'),physicalAddressKey('402 Đ. Vĩnh Khánh'),
 'never combine different house numbers');
assert.equal(normalizedDelivery.places.find(p=>p.invoiceNos.includes('5921')).phones.length,2,
 'different phone numbers at same delivery point do not create new customers');
console.log('PASS real-format Vinh Khanh delivery aliases, separate house number, exact contact sources');

const liveDirectoryRows=[
 {name:'Hà Minh Nguyệt',phone:'0901111111',location:'Block B, Chung cư Kingdom',
  invoiceNo:5911,date:'01/10/2026'},
 {name:'Ha Minh Nguyet',phone:'0912222222',location:'Block B, Chung cư Kingdom',
  invoiceNo:5912,date:'02/10/2026'},
 {name:'Hà Minh Nguyệt',phone:'0901111111',location:'40 Võ Văn Tần, TP.HCM',
  invoiceNo:5913,date:'03/10/2026'},
 {name:'Khách Khác',phone:'0987777777',location:'123 Trần Hưng Đạo',
  invoiceNo:5914,date:'04/10/2026'}
];
const liveDir=directoryFromInvoices(liveDirectoryRows);
const matching=liveDir.find(x=>x.key===directoryKey('Hà Minh Nguyệt'));
assert.equal(liveDir.length,2,'same name with/without Vietnamese diacritics is one customer group');
assert.equal(matching.invoiceCount,3,'three real invoices remain three orders');
assert.equal(matching.deliveryLocationCount,2,'repeat order and different phone at same address count once');
assert.equal(matching.deliveryLocations.find(x=>x.address.includes('Kingdom')).contactCount,2,
 'different numbers must not become new addresses');
assert.equal(liveDir.reduce((n,x)=>n+x.deliveryLocationCount,0),3,
 'dashboard counts actual physical destinations, not profile rows');
const productionAdmin=readFileSync(path.join(root,'admin.html'),'utf8');
assert.match(productionAdmin,/id="productionCustomerDirectory"/);
assert.match(productionAdmin,/id="realProfileCount"/);
assert.match(productionAdmin,/id="realDeliveryCount"/);
assert.match(productionAdmin,/id="productionProfiles"/);
assert.match(productionAdmin,/function renderProductionProfiles\(\)/);
assert.match(productionAdmin,/\$\('agencyRealFind'\)\.click\(\)/);
assert.match(productionAdmin,/showAdminTab\('customers'\)/,'Production customers are initial admin screen');
assert.match(productionAdmin,/id="legacyDemoProfiles" aria-hidden="true"/);
console.log('PASS read-only production customer directory metrics, physical address counts and safe selection');

const {directorySourceQuery}=await import('../owner-customer-directory.mjs');
assert.equal(directorySourceQuery('Traky (các chi nhánh)'),'Traky',
 'do not query an invented label with no matching production invoices');
assert.equal(directorySourceQuery('Traky Hair'),'Traky',
 'branch member resolves to all literal Traky invoices');
assert.equal(directorySourceQuery('Tracy Hair'),'Tracy Hair',
 'distinct Tracy name MUST NOT be silently merged with Traky');
const branchSamples=[
 {name:'Traky Sài Gòn',phone:'0901111111',location:'159 Calmette, Q.1',
  ref:{id:1,invoiceNo:5901},sourceInvoiceNo:5901},
 {name:'Traky Rạch Giá',phone:'0912222222',location:'150 Nguyễn Trung Trực, Rạch Giá',
  ref:{id:2,invoiceNo:5902},sourceInvoiceNo:5902},
 {name:'Traky Hair',phone:'0933333333',location:'75 Quang Trung, Gò Vấp',
  ref:{id:3,invoiceNo:5903},sourceInvoiceNo:5903},
 {name:'Tracy Hair',phone:'0944444444',location:'Tracy khác',
  ref:{id:4,invoiceNo:5904},sourceInvoiceNo:5904}
];
const groupedBranches=detailFromEvidence('Traky (các chi nhánh)',branchSamples,[],{sourceTotal:3});
assert.equal(groupedBranches.count,3,'all three Traky branch locations must appear');
assert.ok(groupedBranches.places.every(p=>p.sourceRows[0].ref.invoiceNo!==5904));
const sourceCode=readFileSync(path.join(root,'server.mjs'),'utf8');
assert.match(sourceCode,/const sourceQuery=directorySourceQuery\(name\)/);
assert.match(sourceCode,/customers\.search',\{query:sourceQuery,limit:20\}/);
assert.match(sourceCode,/monthLookup\(m,sourceQuery\)/);
console.log('PASS Traky group → actual source search prefix; Tracy name isolated');

const contactExamples=[
 ['Hằng - 0784723916','0784723916'],
 ['0784723916 (Hằng)','0784723916'],
 ['0903 507 433 (Cô Hoa)','0903507433'],
 ['+84 903.507.433 (Hoa)','0903507433'],
 ['903507433','903507433'],
 ['(chị Linh) 091-234-5678','0912345678'],
 ['0912345678 / 0909999999',''],
 ['Không có số trong hóa đơn',''],
 ['Mã hóa đơn 5931, khu 2',''],
 ['01234567890123456789','']
];
for(const [input,expected] of contactExamples)
 assert.equal(contactPhone(input),expected,'Contact extraction: '+input);
const legacyMixed=detailFromEvidence('Nhà Hàng Thạnh Phú',[
 {name:'Nhà Hàng Thạnh Phú',phone:'',location:'52 Bình Phú, TP.HCM',
  ref:{id:8,invoiceNo:8},sourceInvoiceNo:8},
 {name:'Nhà Hàng Thạnh Phú',phone:'Hằng - 0784723916',location:'52 Bình Phú, TP.HCM',
  ref:{id:1792745523724,invoiceNo:5931},sourceInvoiceNo:5931}
],[],{sourceTotal:2});
assert.equal(legacyMixed.places.length,1);
assert.equal(legacyMixed.places[0].references.length,2,
 'old phone-less invoice is retained as historical evidence');
assert.equal(legacyMixed.places[0].sourceRows.length,2);
assert.equal(legacyMixed.places[0].sourceRows[0].phone,'',
 'never retrofit the later contact onto an old invoice');
assert.equal(legacyMixed.places[0].sourceRows[1].phone,'0784723916');
assert.equal(legacyMixed.places[0].eligibleSourceCount,1,
 'valid recipient-annotated phone re-enables this physical destination');
assert.equal(legacyMixed.places[0].approvedCandidate,true);
const pwcSource=detailFromEvidence('PWC',[
 {name:'PWC',phone:'',location:'1137 Huỳnh Tấn Phát, q7',
  ref:{id:16,invoiceNo:16},sourceInvoiceNo:16}
],[],{sourceTotal:1});
assert.equal(pwcSource.places.length,1);
assert.equal(pwcSource.places[0].approvedCandidate,false,
 'real Production invoice #16 has no phone; do not invent a contact');
assert.equal(pwcSource.places[0].eligibleSourceCount,0);
const decoratedDirectory=directoryFromInvoices([
 {name:'Nhà Hàng Thạnh Phú',phone:'Hằng - 0784723916',
  location:'52 Bình Phú, TP.HCM',invoiceNo:5931}
]);
assert.deepEqual(decoratedDirectory[0].deliveryLocations[0].phones,['0784723916']);
const sourceRefImplementation=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const sourceSelector=sourceRefImplementation.slice(
 sourceRefImplementation.indexOf("const sources=(Array.isArray(p.sourceRows)"),
 sourceRefImplementation.indexOf("$('agencyRealIssue').onclick"));
assert.match(sourceSelector,/tick\\.disabled=!sources\\.length/);
assert.match(sourceSelector,/tick\\.disabled=!valid/,'owner-verified missing phone enables checkbox');
assert.match(sourceSelector,/manualSources/,'blank historical phone enables review instead of permanent lock');
assert.doesNotMatch(sourceSelector,/tick\.disabled=!refs\.length\|\|!p\.phone/);
assert.match(sourceSelector,/const choices=sources\\.length\\?sources:manualSources/);
assert.match(sourceSelector,/source\\.ref/);
assert.match(sourceSelector,/source\.phone/);
console.log('PASS annotated contact phones, safe exact invoice ref selection and blank PWC record guards');
