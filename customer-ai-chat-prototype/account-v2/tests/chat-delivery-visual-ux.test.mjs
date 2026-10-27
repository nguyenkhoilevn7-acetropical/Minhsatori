import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(inline,'V2 inline application must exist');

const section=(from,to,source=html)=>{
 const a=source.indexOf(from),b=source.indexOf(to,a+from.length);
 assert.ok(a>=0&&b>a,'Cannot locate UI section: '+from);
 return source.slice(a,b);
};
test('inline JS is syntactically valid and original send semantics are unchanged',()=>{
 assert.doesNotThrow(()=>new vm.Script(inline[1],{filename:'account-v2/app.html'}));
 assert.match(inline[1],/bubble\(message,'me'\)/);
 assert.match(inline[1],/\$\('message'\)\.onkeydown=e=>\{if\(e\.key==='Enter'&&!e\.shiftKey&&!e\.isComposing\)/);
 assert.match(html,/\.bubble\.me\{align-self:flex-end;color:#fff;background:var\(--iosOutgoing\)/);
 assert.match(html,/\.bubble\.ai\{align-self:flex-start;color:var\(--iosIncomingInk\);background:var\(--iosIncoming\)/);
});
test('composer text is neutral before sending while the caret may retain iOS blue',()=>{
 assert.match(html,/#message\{color:#1c1c1e;font-weight:450;caret-color:#007aff;-webkit-text-fill-color:#1c1c1e\}/);
 assert.doesNotMatch(html,/#message\{color:var\(--chatBlue\)/);
 assert.match(html,/#message::placeholder\{color:#687d90/);
});
test('delivery dialog uses one location icon in the group heading and omits redundant text',()=>{
 const dialog=section('<dialog id="deliveryDialog"','</dialog>');
 assert.match(dialog,/<svg[^>]*>.*?<\/svg><span>Điểm giao đã lưu<\/span>/s);
 assert.doesNotMatch(dialog,/Địa chỉ đã lưu · ưu tiên địa chỉ từng đặt/);
 assert.match(dialog,/id="agentAddressChoices"/);
 assert.match(dialog,/id="agentAddressManage"/);
 const choices=section("const choices=$('agentAddressChoices');","if(!active.length)choices.append",inline[1]);
 assert.match(choices,/node\('span',address\.label,'address-title'\)/);
 assert.match(choices,/node\('span',address\.address,'address-subtitle'\)/);
 assert.match(choices,/node\('span',address\.recipientPhone\|\|'Chưa lưu số điện thoại','address-phone'\)/);
 assert.doesNotMatch(choices,/lastOrderedAt\?'.*Đã đặt gần đây/);
 assert.doesNotMatch(choices,/cloneNode\(true\)/);
 assert.doesNotMatch(choices,/node\('span',undefined,'pin'\)/);
 assert.match(choices,/button\.onclick=\(\)=>\{/);
 assert.match(choices,/closeDeliveryDialog\(\)/);
});
test('address text remains readable on mobile, including long addresses and phones',()=>{
 assert.match(html,/\.agent-address-choice \.address-title\{[^}]*font-size:16px/);
 assert.match(html,/\.agent-address-choice \.address-subtitle\{[^}]*font-size:15px/);
 assert.match(html,/\.agent-address-choice \.address-phone\{[^}]*font-size:14px/);
 assert.match(html,/\.agent-address-choice \.address-subtitle\{[^}]*white-space:normal;overflow-wrap:anywhere/);
 assert.match(html,/\.agent-address-choice:focus-visible\{outline:2px solid #007aff/);
});
test('Gemini assistance card uses honest guided examples and collapses after first send',()=>{
 const guide=section('<details id="chatHelp"','</details>');
 assert.match(guide,/Hướng dẫn đặt hàng với Gemini/);
 assert.match(guide,/<ul>/);
 assert.match(guide,/<ol>/);
 assert.match(guide,/5 thùng Satori 500ml/);
 assert.match(guide,/Cho thêm 2 thùng ổi hồng/);
 assert.match(guide,/Satori có nước 500ml không\?/);
 assert.match(guide,/Chỉ thêm hàng khi danh mục chính thức đã đồng bộ/);
 assert.match(html,/#messages\{[^}]*overflow-y:auto/);
 assert.match(inline[1],/if\(\$\('chatHelp'\)\)\$\('chatHelp'\)\.open=false/);
 assert.match(inline[1],/const input=\$\('message'\),message=input\.value\.trim\(\)/);
 assert.match(inline[1],/input\.blur\(\)/);
 assert.doesNotMatch(guide,/Xác nhận đơn\"\s*<\/span>|cam kết giao|100%/);
});
