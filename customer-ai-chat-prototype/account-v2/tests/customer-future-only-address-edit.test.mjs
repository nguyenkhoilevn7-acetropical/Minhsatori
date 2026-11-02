import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateCustomerAddressEdit,validateAdminAddressEdit,calculateQuote} from '../domain.mjs';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const router=source('router.mjs'),html=source('app.html');
const accountId='11111111-1111-4111-8111-111111111111';
const profileId='22222222-2222-4222-8222-222222222222';
const addressId='33333333-3333-4333-8333-333333333333';

const address=()=>({
 profileId,addressId,label:'Nhà',recipientName:'Người nhận cũ',
 recipientPhone:'0900000000',address:'Địa chỉ cũ',active:true,
 expectedRevision:3,confirmed:true
});

test('self-service validation is independent of owner credentials and requires confirmation + revision',()=>{
 const allowed=validateCustomerAddressEdit(address());
 assert.equal(allowed.recipientName,'Người nhận cũ');
 assert.equal(allowed.expectedRevision,3);
 assert.throws(()=>validateCustomerAddressEdit({...address(),confirmed:false}),/CUSTOMER_CONFIRMATION_REQUIRED/);
 assert.throws(()=>validateCustomerAddressEdit({...address(),expectedRevision:undefined}),/ADDRESS_REVISION_REQUIRED/);
 assert.throws(()=>validateCustomerAddressEdit({...address(),recipientPhone:'invalid'}),/PHONE_INVALID/);
 assert.throws(()=>validateCustomerAddressEdit({...address(),addressId:'other-account'}),/ADDRESS_ID_REQUIRED/);
 assert.throws(()=>validateAdminAddressEdit({...address(),confirmed:false}),/OWNER_CONFIRMATION_REQUIRED/);
});

test('GET /me supplies CAS revision for retail, agency and CTV and PATCH enforces same-account ownership',()=>{
 const me=router.slice(router.indexOf("if(pathname==='/api/v2/me'&&req.method==='GET')"),
  router.indexOf("if(pathname==='/api/v2/logout'&&req.method==='POST')"));
 const edit=router.slice(router.indexOf("if(pathname==='/api/v2/addresses'&&req.method==='PATCH')"),
  router.indexOf("if(pathname==='/api/v2/cart'&&req.method==='GET')"));
 assert.match(me,/a\.address,a\.active,a\.revision/);
 assert.match(me,/WHERE p\.account_id=\$1/);
 assert.match(edit,/validateCustomerAddressEdit\(await json\(req\)\)/);
 assert.match(edit,/p\.account_id=\$9 AND a\.revision=\$8/);
 assert.match(edit,/ADDRESS_REVISION_CONFLICT/);
 assert.match(edit,/DELIVERY_ADDRESS_EDITED/);
 assert.doesNotMatch(edit,/owner\(actor\)|UPDATE satori_v2_quotes|UPDATE satori_v2_order_requests/);
});

test('changed phone, recipient and street affect NEXT quote only, across all three roles',()=>{
 for(const type of ['retail','agency','collaborator']){
  const profile={id:profileId,accountId,type};
  const original={id:addressId,profileId,active:true,
   label:'Địa chỉ đã lưu',recipientName:'Tên cũ',recipientPhone:'0900000000',
   address:'10 Đường Cũ'};
  const common={accountId,profile,catalogueRevision:1,policies:[],
   catalogue:[{code:'TP-00001',name:'Sản phẩm kiểm thử',unit:'thùng',listPrice:100000,active:true}],
   cart:[{code:'TP-00001',qty:1}]};
  const submitted=calculateQuote({...common,address:original});
  original.recipientName='Tên mới';original.recipientPhone='0912345678';
  original.address='20 Đường Mới';
  const next=calculateQuote({...common,address:original});
  assert.equal(submitted.delivery.recipientName,'Tên cũ',type);
  assert.equal(submitted.delivery.recipientPhone,'0900000000',type);
  assert.equal(submitted.delivery.address,'10 Đường Cũ',type);
  assert.equal(next.delivery.recipientName,'Tên mới',type);
  assert.equal(next.delivery.recipientPhone,'0912345678',type);
  assert.equal(next.delivery.address,'20 Đường Mới',type);
  assert.equal(next.totalVnd,submitted.totalVnd,'contact edit cannot alter prices');
 }
});

test('customer interface has visible per-address edit for all roles and invalidates stale quote',()=>{
 assert.match(html,/const edit=node\('button','✎ Sửa','agent-address-edit'\)/);
 assert.match(html,/entry\.append\(button,edit\);choices\.append\(entry\)/);
 assert.match(html,/\$\('userAddressEditor'\)\.open=true/);
 assert.match(html,/userAddressDraftRevision/);
 assert.match(html,/clearUserAddressDraft\(\);resetTestQuote\(\);invalidateCartPricing\(\)/);
 assert.match(html,/Bill đã submit giữ nguyên người nhận/);
 assert.match(router,/q\.payload->'delivery' AS delivery/);
 assert.match(router,/assertCurrentQuote\(/);
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  assert.doesNotThrow(()=>new vm.Script(match[1]));
 }
});
