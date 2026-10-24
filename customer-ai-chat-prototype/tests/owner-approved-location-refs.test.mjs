import assert from 'node:assert/strict';
import {ownerSelectedLocations,selectedLocationEvidence} from '../owner-approved-location-refs.mjs';

const entries=[
 {name:'Hà Minh Nguyệt',address:'42 Đường 95, Cát Lái',phone:'0392598879',
  references:[{id:1001,invoiceNo:5921},{id:1002,invoiceNo:5918}],
  purchaseCount:2,needsReview:true},
 {name:'Hà Minh Nguyệt',address:'Chung Cư Kingdom Block B',phone:'0389457076',
  references:[{id:68,invoiceNo:68}],needsReview:true},
 {name:'Hà Minh Nguyệt',address:'Địa chỉ không có SĐT',phone:'',
  references:[{id:1003,invoiceNo:80}],needsReview:true},
 {name:'Hà Minh Nguyệt',address:'Địa chỉ thiếu hóa đơn',phone:'0912345678',
  references:[],needsReview:true}
];
const grouped=selectedLocationEvidence(entries);
assert.equal(grouped.candidate.length,2);
assert.equal(grouped.needsReview.length,2);
assert.deepEqual(grouped.candidate[0].ref,{id:1001,invoiceNo:5921});
assert.equal(grouped.candidate[0].needsReview,true);
assert.deepEqual(grouped.candidate[1].ref,{id:68,invoiceNo:68});

// Two distinct physical destinations can have the SAME human invoice number
// if their authoritative row identities differ. Do not throw one away.
const selections=ownerSelectedLocations({destinationRefs:[
 {id:5001,invoiceNo:68},{id:5002,invoiceNo:68}
]});
assert.equal(selections.refs.length,2);
assert.equal(selections.exact,true);
assert.deepEqual(selections.refs[1],{id:5002,invoiceNo:68});

assert.throws(()=>ownerSelectedLocations({destinationRefs:[
 {id:5001,invoiceNo:68},{id:5001,invoiceNo:68}
]}),{code:'CTV_DESTINATIONS_DUPLICATE'});
assert.throws(()=>ownerSelectedLocations({destinationRefs:[{invoiceNo:68}]}),
 {code:'CTV_DESTINATIONS_INVALID'});
assert.throws(()=>ownerSelectedLocations({destinationInvoiceNos:[68,68]}),
 {code:'CTV_DESTINATIONS_DUPLICATE'});
assert.deepEqual(ownerSelectedLocations({destinationInvoiceNos:[68,69]}).refs,
 [{id:null,invoiceNo:68},{id:null,invoiceNo:69}]);
console.log('PASS returning buyers grouped, incomplete separate, owner exact refs and old clients');
