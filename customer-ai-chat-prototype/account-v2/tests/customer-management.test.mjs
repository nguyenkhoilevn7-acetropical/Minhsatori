import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCustomerProfile,validateCustomerStatus} from '../customer-management.mjs';

const form=()=>({fullName:'Cửa hàng Minh Họa',email:'agent@example.invalid',
 phone:'0900000000',address:'123 đường Mẫu, TP.HCM',
 companyName:'Công ty Mẫu',taxCode:'0300000000',note:'Nhận hàng buổi sáng',
 requestedType:'agency'});
test('customer registration captures all requested real form fields without a password',()=>{
 const result=validateCustomerProfile(form());
 assert.equal(result.fullName,form().fullName);
 assert.equal(result.phone,'0900000000');
 assert.equal(result.address,form().address);
 assert.equal(result.email,'agent@example.invalid');
 assert.equal(result.companyName,form().companyName);
 assert.equal(result.taxCode,form().taxCode);
 assert.equal(result.requestedType,'agency');
 assert.equal(result.discountBps,0,'untrusted signup cannot grant own discount');
 assert.equal('password' in result,false);
});
test('registration never stores, echoes, or accepts passwords/tokens/OTP',()=>{
 for(const k of ['password','confirmPassword','otp','token','secret','pin']){
  assert.throws(()=>validateCustomerProfile({...form(),[k]:'sample'}),/CUSTOMER_PASSWORD_NOT_ACCEPTED/);
 }
});
test('Admin can assign bounded per-contact discount; signup cannot self-award',()=>{
 assert.equal(validateCustomerProfile({...form(),discountBps:4500},{admin:true}).discountBps,4500);
 assert.equal(validateCustomerProfile({...form(),discountBps:4500}).discountBps,0);
 for(const percent of [-1,10001,12.5,'1000'])
  assert.throws(()=>validateCustomerProfile({...form(),discountBps:percent},{admin:true}),
   /CUSTOMER_DISCOUNT_INVALID/);
});
test('customer identity requires real name, phone, address and bounded role',()=>{
 for(const [field,value] of [['fullName',''],['phone','xx'],['address',''],['requestedType','admin']])
  assert.throws(()=>validateCustomerProfile({...form(),[field]:value}));
});
test('admin lifecycle requires confirmation and expected record revision',()=>{
 assert.deepEqual(validateCustomerStatus({confirmed:true,status:'SUSPENDED',expectedRevision:2}),
  {status:'SUSPENDED',expectedRevision:2,discountBps:undefined});
 for(const bad of [{status:'ACTIVE',expectedRevision:1},
  {confirmed:true,status:'PENDING',expectedRevision:1},
  {confirmed:true,status:'ACTIVE',expectedRevision:0},
  {confirmed:true,status:'ACTIVE',expectedRevision:1,discountBps:10001}])
  assert.throws(()=>validateCustomerStatus(bad));
});
