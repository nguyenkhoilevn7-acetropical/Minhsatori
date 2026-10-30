import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
const rules=css.split('/* Minh Satori delivery cards:')[1]||'';

test('delivery modal keeps required selection and profile/address interactions',()=>{
 for(const id of ['deliveryDialog','quickAgentProfile','agentAddressMenu',
   'agentAddressChoices','agentAddressManage','deliveryClose']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(inline,/function syncDeliveryDialogGate\(\)/);
 assert.match(inline,/if\(syncDeliveryDialogGate\(\)\)event\.preventDefault\(\)/);
 assert.match(inline,/button\.setAttribute\('aria-pressed'/);
 assert.doesNotThrow(()=>new vm.Script(inline));
});

test('delivery phone and address share a single neutral pill style',()=>{
 assert.match(rules,/#agentAddressChoices \.address-contact-row\{/);
 assert.match(rules,/border:1px solid #e1e8eb;border-radius:10px/);
 assert.match(rules,/background:#f6f8fa;color:#405e6b/);
 assert.match(rules,/#agentAddressChoices \.address-contact-text\{/);
 assert.match(rules,/font-size:14px;line-height:1\.4/);
 assert.match(rules,/\.agent-address-choice\[aria-pressed="true"\]/);
 assert.match(rules,/border-color:#40a7a2;background:#f7fbfa/);
});
test('contact cards stay compact and show only delivery identity fields',()=>{
 assert.match(rules,/#agentAddressChoices \.agent-address-choice\{[\s\S]*?padding:12px 13px/);
 assert.match(rules,/#agentAddressChoices \.agent-address-choice \.address-meta\{[\s\S]*?gap:7px/);
 assert.match(rules,/#agentAddressManage\{min-height:40px/);
 assert.match(rules,/\.delivery-profile-select\{height:40px;min-height:40px/);
 assert.match(rules,/@media\(max-width:420px\)/);
 const choices=inline.split("const choices=$('agentAddressChoices');choices.replaceChildren();")[1]
  ?.split("if(!active.length)choices.append")[0]||'';
 assert.match(choices,/address\.recipientName/);
 assert.match(choices,/address\.recipientPhone/);
 assert.match(choices,/address\.address/);
 assert.doesNotMatch(choices,/invoiceNo|discountBps|goodsVnd|vatVnd|shippingVnd|lineTotal/);
});
