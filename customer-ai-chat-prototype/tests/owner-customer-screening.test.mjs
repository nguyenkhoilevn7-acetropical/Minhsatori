import assert from 'node:assert/strict';
import {screenMonthlyCustomers} from '../owner-customer-screening.mjs';
const sample=[
 {invoiceNo:31,name:'Đại lý A',phone:'0901234567',location:'Q1',total:100000,discountPercent:45,date:'2026-10-02'},
 {invoiceNo:32,name:'Đại lý A',phone:'0901234567',location:'Q7',total:200000,discountPercent:45,date:'2026-10-03'},
 {invoiceNo:33,name:'Đại lý B',phone:'0909999999',location:'HCM',total:50000,discountPercent:30},
 {invoiceNo:34,name:'Đại lý A',location:'Q1',total:70000,discountPercent:45}
];
const grouped=screenMonthlyCustomers(sample);
assert.equal(grouped.length,3,'do not merge by name alone');
assert.equal(grouped[0].recurring,true);
assert.equal(grouped[0].count,2);
assert.equal(grouped[0].total,300000);
assert.deepEqual(grouped[0].addresses,['Q1','Q7']);
assert.equal(grouped[0].suggestedDiscount,45);
assert.equal(grouped[0].identityConflict,false);
const unknown=screenMonthlyCustomers([...sample,{name:'Đại lý A',phone:'0901234567',location:'Q1',discount:45}]);
assert.equal(unknown[0].suggestedDiscount,null,'bare discount may be currency');
const conflict=screenMonthlyCustomers([...sample,{name:'Đại lý A',phone:'0901234567',location:'Q1',discountPercent:35}]);
assert.equal(conflict[0].suggestedDiscount,null);
assert.equal(conflict[0].discountConflict,true);
const cropped=screenMonthlyCustomers(sample,{truncated:true});
assert.ok(cropped.every(x=>x.complete===false));
const samePhoneDiffName=screenMonthlyCustomers([...sample,{name:'Đại lý Khác',phone:'0901234567',location:'Q1',discountPercent:45}]);
assert.equal(samePhoneDiffName[0].identityConflict,true,'shared phone requires owner review');
assert.equal(screenMonthlyCustomers([{name:'X',phone:'',discount:'25%'}])[0].suggestedDiscount,25,'explicit % is valid source evidence');
assert.equal(screenMonthlyCustomers([{name:'X',phone:'',discount:25}])[0].suggestedDiscount,null,'ambiguous bare number is not proof of percent');

const visibleOrder=(n,items)=>({invoiceNo:n,name:'Đại lý A',phone:'0901234567',location:'Q1',total:100000,items});
const lineEvidence=screenMonthlyCustomers([
 visibleOrder(40,[{product:'Nước 500ml',discountPercent:45},{product:'Nước 5L',discountPercent:45}]),
 visibleOrder(41,[{product:'Nước 500ml',discountPercent:45}])
]);
assert.equal(lineEvidence[0].suggestedDiscount,45,
 'BotApi.visible exposes unchanged items, not invoice top-level discount');
assert.equal(screenMonthlyCustomers([
 visibleOrder(42,[{discountPercent:45},{product:'Other item'}])
])[0].suggestedDiscount,null,'missing line discount is not evidence');
assert.equal(screenMonthlyCustomers([
 visibleOrder(43,[{discountPercent:45},{discountPercent:30}])
])[0].suggestedDiscount,null,'mixed item discounts must not be averaged');
assert.equal(screenMonthlyCustomers([
 {...visibleOrder(44,[{discountPercent:30}]),discountPercent:45}
])[0].suggestedDiscount,null,'inconsistent bill and item rates require review');
assert.equal(screenMonthlyCustomers([
 visibleOrder(45,[{discountPercent:0}])
])[0].suggestedDiscount,0,'explicit zero percent is valid evidence');
assert.equal(screenMonthlyCustomers([
 visibleOrder(46,[{discountPercent:'not a percent'}])
])[0].suggestedDiscount,null,'malformed explicit rate must not be inferred');

console.log('PASS owner monthly screen: evidence, identity, incomplete months, no auto link');
