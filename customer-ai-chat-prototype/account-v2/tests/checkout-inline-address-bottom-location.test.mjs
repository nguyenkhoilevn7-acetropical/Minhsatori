import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {calculateQuote} from '../domain.mjs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const nav=html.match(/<nav class="mm-bottom-nav"[\s\S]*?<\/nav>/)?.[0]||'';
const checkout=script.slice(script.indexOf('// The checkout editor modifies'),script.indexOf("$('saveUserAddress').onclick"));

test('Location replaces personal bottom tab without removing account menu',()=>{
 assert.match(nav,/id="bottomDelivery"/);
 assert.match(nav,/<span>Địa chỉ<\/span>/);
 assert.doesNotMatch(nav,/data-view="account"|<span>Cá nhân<\/span>/);
 assert.match(html,/data-view="account">👤 Tài khoản/);
 assert.match(html,/#headerDelivery\{display:none!important\}/);
 assert.match(script,/\$\('bottomDelivery'\)\.onclick=\(\)=>/);
 assert.match(script,/openDeliveryDialog\(\)/);
 assert.match(script,/const views=\['chat','catalogue','cart','addresses','orders','invoiceDetail','account'\]/);
});

test('Checkout contains immediate editor for recipient, phone and saved address',()=>{
 for(const id of ['cartEditDelivery','cartDeliveryEditor','checkoutEditLabel','checkoutEditRecipient',
  'checkoutEditPhone','checkoutEditText','checkoutEditSave','checkoutEditCancel']){
  assert.match(html,new RegExp('id="'+id+'"'),id);
 }
 assert.match(checkout,/selectedDeliveryAddress\(\)/);
 assert.match(checkout,/expectedRevision:checkoutDraftRevision/);
 assert.match(checkout,/confirmed:true,active:true/);
 assert.match(checkout,/call\('\/api\/v2\/addresses',data,'PATCH'\)/);
 assert.match(checkout,/me=fresh/);
 assert.match(checkout,/resetTestQuote\(\);invalidateCartPricing\(\);renderAddresses\(\);renderCart\(\)/);
 assert.match(script,/checkoutDeliveryEditing\|\|checkoutAddressSaving/);
 assert.match(script,/Lưu hoặc hủy chỉnh sửa địa chỉ trước khi gửi đơn/);
 assert.match(checkout,/ADDRESS_REVISION_CONFLICT/);
 assert.match(checkout,/Địa chỉ đã được sửa trên thiết bị khác/);
 assert.doesNotMatch(checkout,/\/api\/v2\/admin\/|\/api\/v2\/confirm|\/api\/v2\/orders\/.*PATCH/);
 assert.doesNotThrow(()=>new vm.Script(script));
});

test('Submitting existing V2 invoice never derives recipient from current address after save',()=>{
 assert.match(router,/q\.payload->\\'delivery\\' AS delivery/);
 assert.match(router,/assertCurrentQuote\(/);
 const acc='11111111-1111-4111-8111-111111111111';
 const profileId='22222222-2222-4222-8222-222222222222';
 const addressId='33333333-3333-4333-8333-333333333333';
 for(const role of ['retail','agency','collaborator']){
  const input={accountId:acc,profile:{id:profileId,accountId:acc,type:role},
   address:{id:addressId,profileId,active:true,label:'Nhà',
    recipientName:'Phụng',recipientPhone:'0911989890',address:'17 Mai Chí Thọ'},
   catalogue:[{code:'TP-00001',name:'Test',unit:'thùng',listPrice:176000,active:true}],
   policies:[],cart:[{code:'TP-00001',qty:1}],catalogueRevision:1};
  const submitted=calculateQuote(input);
  const next=calculateQuote({...input,address:{...input.address,recipientPhone:'0911989891'}});
  assert.equal(submitted.delivery.recipientPhone,'0911989890');
  assert.equal(next.delivery.recipientPhone,'0911989891');
  assert.equal(submitted.totalVnd,next.totalVnd);
 }
});
