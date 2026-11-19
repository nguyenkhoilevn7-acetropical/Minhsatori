import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');

test('Gemini onboarding and required delivery picker use 16/20 text hierarchy',()=>{
 assert.match(html,/--entry-body-size:16px;--entry-title-size:20px/);
 assert.match(html,/\.intro h1,#gate h1\{font-size:var\(--entry-title-size\)\}/);
 assert.match(html,/\.delivery-dialog h2\{font-size:var\(--entry-title-size\)/);
 assert.match(html,/\.delivery-dialog \.delivery-profile-label,/);
 assert.match(html,/\.delivery-dialog \.agent-address-choice \.address-title,/);
 assert.match(html,/\.delivery-dialog \.agent-address-choice \.address-phone,/);
 assert.match(html,/\.chat-help-content \.chat-help-note\{/);
 assert.match(html,/\.delivery-dialog \.delivery-dialog-brand/);
});
test('Gemini delivery and official order controls still exist and parse',()=>{
 for(const id of ['deliveryDialog','quickAgentProfile','agentAddressMenu','submitTestOrder']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.ok(blocks.length>0);
 for(const b of blocks)assert.doesNotThrow(()=>new vm.Script(b[1]));
});