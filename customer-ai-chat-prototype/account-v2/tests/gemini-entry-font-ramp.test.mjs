import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
test('initial Gemini and mandatory delivery dialog use 16px body and 20px title ramp',()=>{
 assert.match(html,/--entry-body-size:16px;--entry-title-size:20px/);
 assert.match(html,/\.intro h1,#gate h1\{font-size:var\(--entry-title-size\)\}/);
 assert.match(html,/\.delivery-dialog h2\{font-size:var\(--entry-title-size\)/);
 assert.match(html,/\.delivery-dialog \.delivery-profile-label,/);
 assert.match(html,/\.delivery-dialog \.agent-address-choice \.address-title,/);
 assert.match(html,/\.delivery-dialog \.agent-address-choice \.address-phone,/);
 assert.match(html,/\.chat-help-content \.chat-help-note\{/);
 assert.match(html,/\.delivery-dialog \.delivery-dialog-brand/);
});
test('delivery choice and checkout are preserved',()=>{
 assert.match(html,/id="deliveryDialog"/);
 assert.match(html,/id="quickAgentProfile"/);
 assert.match(html,/id="agentAddressMenu"/);
 assert.match(html,/id="submitTestOrder"/);
 const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.ok(blocks.length>0);
 for(const b of blocks)assert.doesNotThrow(()=>new vm.Script(b[1]));
});