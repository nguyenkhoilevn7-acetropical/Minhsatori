import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
const rules=css.split('/* V2 delivery picker refinement:')[1]||'';

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

test('address and phone show equal plain typography, no duplicated highlight pills',()=>{
 assert.match(rules,/#agentAddressChoices \.agent-address-choice \.address-subtitle,\s*\.delivery-dialog #agentAddressChoices \.agent-address-choice \.address-phone\{/);
 assert.match(rules,/margin:0;padding:0;border:0;border-radius:0;background:transparent/);
 assert.match(rules,/font-size:14px;line-height:1\.4;font-weight:500/);
 assert.match(rules,/#agentAddressChoices \.agent-address-choice\[aria-pressed="true"\]/);
 assert.match(rules,/background:#f0f8f6/);
});

test('delivery picker spacing shrinks without losing touch targets',()=>{
 assert.match(rules,/#agentAddressChoices\{display:grid;gap:7px\}/);
 assert.match(rules,/\.agent-address-choice\{[\s\S]*?min-height:0;margin:0;padding:12px 13px/);
 assert.match(rules,/#agentAddressManage\{min-height:39px/);
 assert.match(rules,/\.delivery-profile-select\{height:41px;min-height:41px/);
 assert.match(rules,/@media\(max-width:420px\)/);
});
