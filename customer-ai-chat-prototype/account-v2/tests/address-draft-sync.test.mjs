import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=html.indexOf('// Drafts are local only.');
const end=html.indexOf('function selectedDeliveryAddress(){',start);
assert.ok(start>=0&&end>start,'Expected the actual address draft state machine');
const source=html.slice(start,end);

function fixture(){
 const account={profiles:[{id:'p1'},{id:'p2'}],addresses:[
  {id:'a1',profileId:'p1',label:'Nhà',recipientName:'Người nhận A',recipientPhone:'09000',address:'Địa chỉ cũ',active:true,revision:3},
  {id:'a2',profileId:'p1',label:'Văn phòng',recipientName:'Người nhận B',recipientPhone:'09111',address:'Địa chỉ B',active:true,revision:1}
 ]};
 const nodes={profile:{value:'p1'},userEditAddress:{value:'a1'},
  saveUserAddress:{disabled:false},userEditLabel:{value:''},
  userEditRecipient:{value:''},userEditPhone:{value:''},
  userEditText:{value:''},userEditActive:{checked:false}};
 for(const node of Object.values(nodes))node.addEventListener=()=>{};
 const context=vm.createContext({
  me:account,
  '$':id=>nodes[id]
 });
 vm.runInContext(source,context);
 return {account,nodes,eval:s=>vm.runInContext(s,context)};
}
test('background read preserves dirty recipient and address text and original CAS revision',()=>{
 const x=fixture();
 x.eval('userAddressSelection()');
 assert.equal(x.nodes.userEditText.value,'Địa chỉ cũ');
 x.nodes.userEditText.value='Đang gõ địa chỉ chưa lưu';
 x.eval('markUserAddressDraft()');
 assert.equal(x.eval('userAddressDraftRevision'),3);
 x.account.addresses[0]={...x.account.addresses[0],address:'Địa chỉ từ điện thoại khác',revision:4};
 x.eval('userAddressSelection()');
 assert.equal(x.nodes.userEditText.value,'Đang gõ địa chỉ chưa lưu');
 assert.equal(x.eval('userAddressDraftRevision'),3,
  'Must submit the revision from first edit, not a newer remote revision');
 assert.equal(x.eval('userAddressDraftId'),'a1');
});
test('switching to a different address invalidates prior draft and renders current data',()=>{
 const x=fixture();
 x.eval('userAddressSelection()');
 x.nodes.userEditText.value='Nháp';
 x.eval('markUserAddressDraft()');
 x.nodes.userEditAddress.value='a2';
 x.eval('clearUserAddressDraft();userAddressSelection()');
 assert.equal(x.nodes.userEditText.value,'Địa chỉ B');
 assert.equal(x.eval('userAddressDraftDirty'),false);
 assert.equal(x.eval('userAddressDraftRevision'),null);
});
test('removed address disables write and clears original draft metadata',()=>{
 const x=fixture();
 x.eval('userAddressSelection()');
 x.eval('markUserAddressDraft()');
 x.account.addresses=x.account.addresses.filter(a=>a.id!=='a1');
 x.eval('userAddressSelection()');
 assert.equal(x.nodes.saveUserAddress.disabled,true);
 assert.equal(x.eval('userAddressDraftDirty'),false);
 assert.equal(x.eval('userAddressDraftRevision'),null);
});
test('server CAS uses originally edited revision, and explicit successful or conflict readback clears draft',()=>{
 assert.match(html,/expectedRevision:userAddressDraftDirty&&userAddressDraftId===old\.id&&/);
 assert.match(html,/userAddressDraftProfileId===old\.profileId\?userAddressDraftRevision:old\.revision/);
 assert.match(html,/clearUserAddressDraft\(\);renderAddresses\(\);toast\('Đã cập nhật địa chỉ giao hàng'\)/);
 assert.match(html,/if\(e\.message==='ADDRESS_REVISION_CONFLICT'\)\{\s*me=await call\('\/api\/v2\/me'/);
 assert.doesNotMatch(source,/localStorage|sessionStorage|fetch\(/);
});
