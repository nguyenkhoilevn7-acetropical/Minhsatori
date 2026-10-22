import assert from 'node:assert/strict';
import {observedRealCustomerDiscounts} from '../owner-review-pricing.mjs';
const line=(listPrice,unitPrice,discountAmount)=>({listPrice,unitPrice,discountAmount});
const row=(name,invoiceNo,items)=>({name,invoiceNo,items});
const consistent=observedRealCustomerDiscounts([
 row('Hà Minh Nguyệt',1,[line(110000,88000,22000)]),
 row('Ha Minh Nguyet',2,[line(333333,266666,66667)])
],'Hà Minh Nguyệt');
assert.deepEqual(consistent.observedRates,[20]);
assert.equal(consistent.suggestedDiscount,20);
assert.equal(consistent.shippingPercent,null);
assert.equal(consistent.vatPercent,null);
const mixed=observedRealCustomerDiscounts([
 row('Hà Minh Nguyệt',3,[line(110000,88000,22000),line(110000,71500,38500)]),
 row('Hà Minh Nguyệt',4,[line(110000,88000,22000)])
],'Hà Minh Nguyệt');
assert.deepEqual(mixed.observedRates,[20,35]);
assert.equal(mixed.suggestedDiscount,null);
const unclear=observedRealCustomerDiscounts([row('Traky Hair',7,[line(100000,85000,null)])],'Traky');
assert.equal(unclear.suggestedDiscount,null);
assert.equal(unclear.unsupportedLines,1);
const unrelated=observedRealCustomerDiscounts([row('Tracy Hair',6,[line(100000,70000,30000)])],'Traky');
assert.deepEqual(unrelated.observedRates,[]);
assert.equal(unrelated.suggestedDiscount,null);
console.log('PASS customer owner review: price-only evidence, mixed rates blocked, shipping/VAT never guessed');
