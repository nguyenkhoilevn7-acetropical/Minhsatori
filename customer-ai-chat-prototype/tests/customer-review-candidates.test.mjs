import assert from 'node:assert/strict';
import {customerReviewCandidates} from '../customer-review-candidates.mjs';
const fake=[
 {id:1,invoiceNo:100,date:'2026-10-03',name:'Đại lý Mẫu',phone:'0900000001',location:'Địa chỉ A, thử nghiệm',
  items:[{code:'TP-00003',listPrice:100000,unitPrice:80000,discountPercent:20}],total:80000},
 {id:2,invoiceNo:101,date:'2026-10-04',name:'Đại lý Mẫu',phone:'0900000001',location:'Địa chỉ B, thử nghiệm',
  items:[{code:'TP-00003',listPrice:100000,unitPrice:80000,discountPercent:20}],total:80000},
 {id:3,invoiceNo:102,date:'2026-10-05',name:'Đại lý Mẫu',phone:'0900000002',location:'Địa chỉ C, thử nghiệm',
  items:[{code:'TP-00003',listPrice:100000,unitPrice:70000}],total:70000},
 {id:4,invoiceNo:103,date:'2026-10-06',name:'Khách Hàng Khác',phone:'0900000003',location:'Địa chỉ D, thử nghiệm',
  items:[{code:'TP-00003',listPrice:100000,unitPrice:80000,discountPercent:20}],total:80000},
 {id:5,invoiceNo:104,date:'2026-10-07',name:'Khách Hàng Khác',phone:'0900000003',location:'Địa chỉ D, thử nghiệm',
  items:[{code:'TP-00056',listPrice:100000,unitPrice:65000,discountPercent:35}],total:65000},
 {id:6,invoiceNo:105,date:'2026-10-08',name:'Khách Bị Huỷ',phone:'0900000004',location:'Địa chỉ E, thử nghiệm',
  status:'Đã hủy',items:[],total:0}
];
const out=customerReviewCandidates([...fake,fake[0]],{complete:false});
assert.equal(out.length,3,'group by name AND phone, exclude cancellations');
const a=out.find(x=>x.phone==='0900000001');
assert.equal(a.invoiceCount,2,'deduplicate by exact source invoice id');
assert.equal(a.locations.length,2,'preserve all delivery addresses');
assert.equal(a.suggestedDiscountPercent,20,'explicit consistent discount suggested for review');
assert.ok(a.reviewFlags.includes('MULTIPLE_ADDRESSES'));
assert.ok(a.reviewFlags.includes('INCOMPLETE_SOURCE'));
assert.equal(a.status,'pending_owner_review');
assert.equal(a.linkCreated,false,'never create customer links');
const b=out.find(x=>x.phone==='0900000002');
assert.equal(b.suggestedDiscountPercent,null,'derived discount is never authorization');
assert.ok(b.reviewFlags.includes('DISCOUNT_DERIVED_ONLY'));
const c=out.find(x=>x.phone==='0900000003');
assert.equal(c.suggestedDiscountPercent,null,'conflicting discounts cannot auto fill');
assert.ok(c.reviewFlags.includes('DISCOUNT_CONFLICT'));
assert.throws(()=>customerReviewCandidates(null),/INVALID_REVIEW_SOURCE/);
console.log('CUSTOMER_REVIEW_CANDIDATES_PASS');
