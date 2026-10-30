import test from 'node:test';
import assert from 'node:assert/strict';
import {DomainError,normalizeCart,validateAddress,validateAdminAddressEdit,validateAdminProfileEdit,selectPolicy,calculateQuote} from '../domain.mjs';
const accountId='84cc53bc-fdf4-44d0-8466-8ef7c4ae3091';
const otherAccount='155b330b-6690-4b3f-b389-a5223d9f73cd';
const profileId='3741eecd-2acd-4a35-8383-510c360b78d9';
const addressId='c03ec9e3-f568-4542-8f96-bd21fed4d094';
const otherAddress='c33ec9e3-f568-4542-8f96-bd21fed4d095';
const catalogue=[{code:'TP-00001',name:'Satori 350ml',unit:'Thùng',listPrice:88000},
 {code:'TP-00003',name:'Satori 500ml',unit:'Thùng',listPrice:98000}];
const profile={id:profileId,accountId,type:'collaborator'};
const address={id:addressId,profileId,active:true,label:'Nhà (mẫu)',recipientName:'Nguyễn Minh',
 recipientPhone:'0900000000',address:'Số 10, đường kiểm thử'};
const base={accountId,profile,address,catalogue,cart:[{code:'TP-00003',qty:10}],
 catalogueRevision:170,shippingVnd:0,vatBps:0};
const policy=(discountBps=2000,extra={})=>({id:'policy-1',profileId,addressId:null,productCode:null,
 enabled:true,version:1,invoiceMode:'single',discountBps,...extra});
function code(fn){try{fn();return 'NO_ERROR'}catch(e){return e.code||e.message}}
test('one cart merges duplicate SKU and refuses over-limit quantities',()=>{
 assert.deepEqual(normalizeCart([{code:'TP-00003',qty:2},{code:'TP-00003',qty:3}]),[{code:'TP-00003',qty:5}]);
 assert.equal(code(()=>normalizeCart([{code:'TP-00003',qty:501}])), 'QUANTITY_INVALID');
 assert.equal(code(()=>normalizeCart([{code:'TP-00003',qty:300},{code:'TP-00001',qty:300}])), 'CART_TOO_LARGE');
});
test('address validation protects contacts',()=>{
 assert.deepEqual(validateAddress({label:'Nhà',recipientName:'Linh',recipientPhone:'0978 111 222',address:'TP HCM'}),
 {label:'Nhà',recipientName:'Linh',recipientPhone:'0978111222',address:'TP HCM'});
 assert.equal(code(()=>validateAddress({label:'Nhà',recipientName:'Linh',recipientPhone:'hi',address:'TP HCM'})),'PHONE_INVALID');
});
test('no approved policy = no discount',()=>{
 const q=calculateQuote(base);
 assert.equal(q.totalVnd,980000);
 assert.equal(q.invoiceMode,'single');
});
test('quote freezes the exact recipient phone/address independent of later address changes',()=>{
 const input={...address};
 const result=calculateQuote({...base,address:input});
 assert.equal(result.delivery.recipientName,'Nguyễn Minh');
 assert.equal(result.delivery.recipientPhone,'0900000000');
 assert.equal(result.delivery.address,'Số 10, đường kiểm thử');
 input.address='Địa chỉ đã đổi sau báo giá';
 assert.equal(result.delivery.address,'Số 10, đường kiểm thử');
 assert.equal(Object.isFrozen(result.delivery),true);
 assert.equal(code(()=>calculateQuote({...base,address:{...address,recipientPhone:'invalid'}})),'PHONE_INVALID');
});
test('20% customer discount comes from approved server policy, not user input',()=>{
 const q=calculateQuote({...base,policies:[policy()]});
 assert.equal(q.totalVnd,784000);
 assert.equal(q.items[0].discountBps,2000);
 assert.equal(q.internalReference,undefined);
});
test('address/product policy overrides generic policy',()=>{
 const q=calculateQuote({...base,policies:[policy(2000),
  policy(3500,{id:'policy-2',addressId,productCode:'TP-00003',version:2})]});
 assert.equal(q.totalVnd,637000);
 assert.equal(q.policyVersion,2);
});
test('other address uses base discount, not discount for a different address',()=>{
 const q=calculateQuote({...base,address:{...address,id:otherAddress},
 policies:[policy(2000),policy(3500,{id:'policy-2',addressId,version:2})]});
 assert.equal(q.totalVnd,784000);
});
test('discount 100% is valid and totals zero',()=>{
 const q=calculateQuote({...base,policies:[policy(10000)]});
 assert.equal(q.totalVnd,0);
});
test('CTV pair uses TWO independently calculated totals; never adds both as revenue',()=>{
 const q=calculateQuote({...base,policies:[policy(2000,{invoiceMode:'pair',collaboratorBps:3500})]});
 assert.equal(q.totalVnd,784000);
 assert.equal(q.internalReference.totalVnd,637000);
 assert.equal(q.invoiceMode,'pair');
 assert.match(q.internalReference.note,/never double-count/);
});
test('CTV pair forbidden on ordinary retail account',()=>{
 const q=()=>calculateQuote({...base,profile:{...profile,type:'retail'},
 policies:[policy(2000,{invoiceMode:'pair',collaboratorBps:3500})]});
 assert.equal(code(q),'PAIR_NOT_AUTHORIZED');
});
test('no cross-account or cross-profile access even with valid UUID',()=>{
 assert.equal(code(()=>calculateQuote({...base,accountId:otherAccount})),'PROFILE_FORBIDDEN');
 assert.equal(code(()=>calculateQuote({...base,address:{...address,profileId:otherAccount}})),'ADDRESS_FORBIDDEN');
});
test('stale catalogue, invalid price or unknown product rejects checkout',()=>{
 assert.equal(code(()=>calculateQuote({...base,catalogueRevision:0})),'CATALOGUE_NOT_AUTHORITATIVE');
 assert.equal(code(()=>calculateQuote({...base,catalogue:[{...catalogue[0],listPrice:-1}]})),'CATALOGUE_INVALID');
 assert.equal(code(()=>calculateQuote({...base,cart:[{code:'TP-99999',qty:1}]})),'PRODUCT_UNAVAILABLE');
});
test('mixed pair/single policy never generates one-sided invoice',()=>{
 const policies=[policy(2000,{invoiceMode:'pair',collaboratorBps:3500,productCode:'TP-00001'}),
  policy(2000,{productCode:'TP-00003'})];
 const cart=[{code:'TP-00001',qty:1},{code:'TP-00003',qty:1}];
 assert.equal(code(()=>calculateQuote({...base,cart,policies})),'MIXED_INVOICE_POLICY');
});
test('same-priority policy collision fails closed',()=>{
 const policies=[policy(2000),policy(3500,{id:'other'})];
 assert.equal(code(()=>calculateQuote({...base,policies})),'POLICY_AMBIGUOUS');
});

test('owner address edit requires explicit confirmation and exact version',()=>{
 const payload={profileId,addressId,expectedRevision:1,confirmed:true,
  active:false,label:'Chi nhánh 2',recipientName:'Khách',recipientPhone:'0987654321',
  address:'123 địa chỉ thử nghiệm'};
 assert.deepEqual(validateAdminAddressEdit(payload),{
  profileId,addressId,expectedRevision:1,active:false,label:'Chi nhánh 2',
  recipientName:'Khách',recipientPhone:'0987654321',address:'123 địa chỉ thử nghiệm'});
 assert.equal(code(()=>validateAdminAddressEdit({...payload,confirmed:false})),'OWNER_CONFIRMATION_REQUIRED');
 assert.equal(code(()=>validateAdminAddressEdit({...payload,expectedRevision:0})),'ADDRESS_REVISION_REQUIRED');
 assert.equal(code(()=>validateAdminAddressEdit({...payload,active:'false'})),'ADDRESS_ACTIVE_REQUIRED');
 assert.equal(code(()=>validateAdminAddressEdit({...payload,addressId:'bad-id'})),'ADDRESS_ID_REQUIRED');
 assert.equal(code(()=>validateAdminAddressEdit({...payload,recipientPhone:'foo'})),'PHONE_INVALID');
});

test('owner profile correction is a version-guarded, confirmed metadata edit',()=>{
 const input={profileId,expectedRevision:3,confirmed:true,name:'  Đại lý Satori  ',phone:'0987 654 321'};
 assert.deepEqual(validateAdminProfileEdit(input),{profileId,expectedRevision:3,name:'Đại lý Satori',phone:'0987654321'});
 assert.equal(code(()=>validateAdminProfileEdit({...input,confirmed:false})),'OWNER_CONFIRMATION_REQUIRED');
 assert.equal(code(()=>validateAdminProfileEdit({...input,expectedRevision:0})),'PROFILE_REVISION_REQUIRED');
 assert.equal(code(()=>validateAdminProfileEdit({...input,name:'  '})),'NAME_INVALID');
 assert.equal(code(()=>validateAdminProfileEdit({...input,phone:'not a phone'})),'PHONE_INVALID');
});
