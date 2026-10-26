import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
test('header shows agency/profile and map-pin beside only one cart',()=>{
 const header=html.match(/<header>([\s\S]*?)<\/header>/)?.[1]||'';
 assert.match(header,/id="headerProfile"/);
 assert.match(header,/id="headerDelivery"/);
 assert.match(header,/id="cartBadge"/);
 assert.ok(header.indexOf('id="headerProfile"')<header.indexOf('id="cartBadge"'));
 assert.ok(header.indexOf('id="headerDelivery"')<header.indexOf('id="cartBadge"'));
 assert.match(header,/class="satori-logo"/);
});
test('login dialog makes explicit previous/saved delivery choice in compact accessible panel',()=>{
 assert.match(html,/<dialog id="deliveryDialog" class="delivery-dialog"/);
 assert.match(html,/id="deliveryDialogTitle">Chọn địa điểm giao hàng/);
 assert.match(html,/Vui lòng chọn địa điểm để bắt đầu order/);
 assert.match(html,/id="quickAgentProfile" class="delivery-profile-select"/);
 assert.match(html,/id="agentAddressMenu" class="agent-address-menu" open/);
 assert.match(html,/summary title="Chọn điểm giao hàng" aria-label="Chọn địa chỉ giao hàng"/);
 assert.match(html,/id="agentAddressChoices"/);
 assert.match(html,/id="agentAddressHint" class="sr-only"/);
 assert.match(html,/\.delivery-dialog::backdrop\{/);
 assert.match(html,/\.agent-address-choice\[aria-pressed="true"\]/);
 assert.doesNotMatch(html,/class="agent-compact"/);
});
test('modal choices are scoped to profile, explicit selection and validated quote gate',()=>{
 assert.match(script,/me\?\.addresses\?\.filter\(x=>x\.profileId===\$\('profile'\)\.value&&x\.active\)/);
 assert.match(script,/const choices=\$\('agentAddressChoices'\);choices\.replaceChildren\(\)/);
 assert.match(script,/button\.setAttribute\('aria-pressed',String\(address\.id===\$\('location'\)\.value\)\)/);
 assert.match(script,/deliverySelectionProfileId=\$\('profile'\)\.value;\s*\$\('location'\)\.value=address\.id;\s*resetTestQuote\(\);invalidateCartPricing\(\);\s*renderAddresses\(\);\s*closeDeliveryDialog\(\)/);
 assert.match(script,/if\(!selectedDeliveryAddress\(\)\)openDeliveryDialog\(\)/);
 assert.match(script,/\$\('headerProfile'\)\.onclick=openDeliveryDialog/);
 assert.match(script,/\$\('headerDelivery'\)\.onclick=openDeliveryDialog/);
 assert.match(script,/\$\('agentAddressManage'\)\.onclick=.*view\('addresses'\)/);
 assert.match(script,/\$\('quickAgentProfile'\)\.onchange=async/);
 assert.match(script,/const line=node\('details',undefined,'saved-address'\)/);
 assert.match(html,/\.saved-address>summary\{/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
