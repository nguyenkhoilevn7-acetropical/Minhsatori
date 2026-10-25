import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {assertSelectedDelivery} from '../router.mjs';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const account='a0000000-1111-4111-8111-000000000001';
const profile='a0000000-1111-4111-8111-000000000002';
const address='a0000000-1111-4111-8111-000000000003';
const actor={id:account};
test('chat rejects missing delivery, wrong-profile and malformed selection',async()=>{
 const pool={query:async()=>{throw Error('should not query')}};
 for(const values of [{},{profileId:profile},{addressId:address},{profileId:'?',addressId:address}]){
  await assert.rejects(assertSelectedDelivery(pool,actor,values),{code:'DELIVERY_ADDRESS_REQUIRED',status:409});
 }
});
test('delivery validation scopes active destination to authenticated account',async()=>{
 let params,sql;
 const pool={query:async(q,p)=>{params=p;sql=q;return {rows:[{id:address}]} }};
 assert.equal(await assertSelectedDelivery(pool,actor,{profileId:profile,addressId:address}),true);
 assert.deepEqual(params,[address,profile,account]);
 assert.match(sql,/p\.account_id=\$3/);
 assert.match(sql,/a\.active=true/);
 assert.match(sql,/a\.profile_id=\$2/);
});
test('disabled, foreign or nonexistent address cannot be used',async()=>{
 const pool={query:async()=>({rows:[]})};
 await assert.rejects(assertSelectedDelivery(pool,actor,{profileId:profile,addressId:address}),
  {code:'DELIVERY_ADDRESS_REQUIRED',status:409});
});
test('frontend never silently chooses the first profile address and guards chat/cart/quote',()=>{
 assert.match(inline,/deliverySelectionProfileId=null/);
 assert.match(inline,/const initial=node\('option','Chọn địa chỉ giao hàng'\)/);
 assert.match(inline,/if\(deliverySelectionProfileId!==\$\('profile'\)\.value\)/);
 assert.match(inline,/if\(lines\.length&&!requireDeliverySelection\(\)\)/);
 assert.match(inline,/if\(!requireDeliverySelection\(\)\)return/);
 assert.match(inline,/call\('\/api\/v2\/interpret',\{message,profileId:\$\('profile'\)\.value,addressId:destination\.id\}\)/);
 assert.match(html,/id="deliveryPrompt"/);
 assert.match(html,/id="cartBadge"/);
 assert.doesNotMatch(html,/id="chatCartShortcut"/);
 assert.doesNotThrow(()=>new vm.Script(inline));
});
