import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateQuote,selectPolicy} from '../domain.mjs';
import {legacyPhoneCandidate} from '../customer-backend.mjs';

const accountId='84cc53bc-fdf4-44d0-8466-8ef7c4ae3091';
const profileId='3741eecd-2acd-4a35-8383-510c360b78d9';
const addressId='c03ec9e3-f568-4542-8f96-bd21fed4d094';
const profile={id:profileId,accountId,type:'collaborator'};
const address={id:addressId,profileId,active:true,label:'Nhà',recipientName:'CTV',
 recipientPhone:'0900000000',address:'Hồ Chí Minh'};
const cat=[{code:'TP-00003',name:'Satori 500ml',unit:'Thùng',listPrice:98000}];
const policy={id:'P1',profileId,addressId:null,productCode:null,enabled:true,version:1,
 discountBps:2000,collaboratorBps:3500,invoiceMode:'single'};
const args={accountId,profile,address,catalogue:cat,cart:[{code:'TP-00003',qty:10}],
 catalogueRevision:1,vatBps:0,shippingVnd:0,policies:[policy]};
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');

test('CTV 35%, client 20% has exactly one customer invoice and 15% VND margin',()=>{
 const quoted=calculateQuote(args);
 assert.equal(quoted.invoiceMode,'single');
 assert.equal(quoted.totalVnd,784000);
 assert.equal(quoted.collaboratorMarginVnd,147000);
 assert.equal(quoted.internalReference.goodsVnd,637000);
 assert.equal(quoted.internalReference.marginVnd,147000);
 assert.equal(quoted.items.length,1);
 assert.equal(quoted.items[0].unitPrice,78400);
 assert.equal(quoted.items[0].internalUnitPrice,63700);
});
test('CTV rate must never be less than client rate',()=>{
 assert.throws(()=>calculateQuote({...args,policies:[{...policy,collaboratorBps:1500}]}),
  /CTV_RATE_INVALID/);
});
test('ordinary profile cannot be assigned independent collaborator economics',()=>{
 assert.match(router,/input\.collaboratorBps==null\|\|profile\.rows\[0\]\.type==='collaborator'/);
 assert.match(router,/ONE_INVOICE_REQUIRED/);
 assert.match(router,/mode:'single'/);
});
test('historical SĐT can carry a parenthesized contact note, but cannot grant identity',()=>{
 assert.equal(legacyPhoneCandidate('0358707777 (Nguyệt)'),'0358707777');
 assert.equal(legacyPhoneCandidate('076 815 2072'),'0768152072');
 assert.equal(legacyPhoneCandidate('☎ 0983.000.970'),'0983000970');
 assert.equal(legacyPhoneCandidate('chưa có số điện thoại'),'');
});
