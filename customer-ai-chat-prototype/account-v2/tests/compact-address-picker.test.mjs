import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
test('compact inline address selector uses accessible app-style icons, no redundant visible heading',()=>{
 assert.match(html,/class="agent-compact"/);
 assert.match(html,/class="agent-avatar"[^>]*><svg/);
 assert.match(html,/id="quickAgentProfile" aria-label="Chọn khách hàng hoặc đại lý"/);
 assert.match(html,/id="agentAddressMenu" class="agent-address-menu"/);
 assert.match(html,/summary title="Chọn điểm giao hàng" aria-label="Chọn địa chỉ giao hàng"/);
 assert.match(html,/id="agentAddressChoices"/);
 assert.match(html,/id="agentAddressHint" class="sr-only"/);
 assert.doesNotMatch(html,/<label for="quickAgentProfile"/);
 assert.match(html,/\.agent-address-popover\{[^}]*max-height:48dvh/);
 assert.match(html,/\.agent-address-choice\[aria-pressed="true"\]/);
});
test('address choices are current profile only, selectable and invalidate old quote',()=>{
 assert.match(script,/me\.addresses\.filter\(x=>x\.profileId===\$\('profile'\)\.value&&x\.active\)/);
 assert.match(script,/const choices=\$\('agentAddressChoices'\);choices\.replaceChildren\(\)/);
 assert.match(script,/button\.setAttribute\('aria-pressed',String\(address\.id===\$\('location'\)\.value\)\)/);
 assert.match(script,/\$\('location'\)\.value=address\.id;\s*resetTestQuote\(\);\s*\$\('agentAddressMenu'\)\.open=false/);
 assert.match(script,/\$\('agentAddressManage'\)\.onclick=.*view\('addresses'\)/);
 assert.match(script,/\$\('quickAgentProfile'\)\.onchange=async/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
