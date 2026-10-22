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
