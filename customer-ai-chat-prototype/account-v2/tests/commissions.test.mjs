import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGrant,commissionQuote,customerQuote} from '../commissions.mjs';
import {calculateQuote} from '../domain.mjs';
const profileId='3741eecd-2acd-4a35-8383-510c360b78d9',accountId='84cc53bc-fdf4-44d0-8466-8ef7c4ae3091';
const grant={profileId,collaboratorAccountId:accountId,enabled:true,expectedRevision:0,
 confirmed:true,customerBps:2000,collaboratorBps:3500,minCustomerBps:0,maxCustomerBps:3000};
test('CTV may edit only customer rate and cannot submit admin-controlled fields',()=>{
 validateGrant(grant);
 assert.throws(()=>validateGrant(grant,{customerOnly:true}),/CTV_CANNOT_CHANGE_ADMIN_GRANT/);
 validateGrant({profileId,expectedRevision:1,confirmed:true,customerBps:2000},{customerOnly:true});
 assert.throws(()=>validateGrant({...grant,maxCustomerBps:4000}),/CTV_DISCOUNT_OUT_OF_RANGE/);
 assert.throws(()=>validateGrant({...grant,customerBps:-1}),/CUSTOMER_DISCOUNT_INVALID/);
});
const base={accountId,profile:{id:profileId,accountId,type:'collaborator'},
 address:{id:'c03ec9e3-f568-4542-8f96-bd21fed4d094',profileId,active:true,label:'Test',
 recipientName:'Synthetic',recipientPhone:'0900000000',address:'Synthetic address'},
 catalogue:[{code:'TP-00001',name:'Test water',unit:'box',listPrice:100000}],
 catalogueRevision:1,cart:[{code:'TP-00001',qty:10}]};
test('one million example produces exactly 800k customer / 650k settlement / 150k commission',()=>{
 const q=commissionQuote(calculateQuote(base),{customer_bps:2000,collaborator_bps:3500,
  collaborator_account_id:accountId,revision:4});
 assert.equal(q.invoiceMode,'single');assert.equal(q.totalVnd,800000);
 assert.equal(q.commission.settlementGoodsVnd,650000);assert.equal(q.commission.commissionVnd,150000);
 assert.equal(q.commission.companyProfitVnd,null);assert.equal(q.commission.grantVersion,4);
 const retail=customerQuote(q);assert.equal(retail.savingsVnd,200000);
 assert.doesNotMatch(JSON.stringify(retail),/internal|commission|collaborator|settlement|companyProfit/);
});
test('legacy pair compatibility produces one invoice and excludes tax and shipping from commission',()=>{
 const q=calculateQuote({...base,vatBps:1000,shippingVnd:50000,policies:[{
  id:'legacy',profileId,enabled:true,version:1,invoiceMode:'pair',discountBps:2000,collaboratorBps:3500}]});
 assert.equal(q.invoiceMode,'single');assert.equal(q.totalVnd,930000);
 assert.equal(q.commission.commissionVnd,150000);
 assert.doesNotMatch(JSON.stringify(customerQuote(q)),/internal|commission|settlement/);
});
