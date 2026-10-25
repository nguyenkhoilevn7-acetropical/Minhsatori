import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
function rule(selector){
 const escaped=selector.replace(/[.*+?^$()|[\]{}]/g,'\\$&');
 return css.match(new RegExp('(?:^|\\n)'+escaped+'\\{([^}]+)\\}'))?.[1]||'';
}
test('customer messages use iOS blue bubble with white text on right',()=>{
 assert.match(css,/--iosOutgoing:#007aff/);
 const mine=rule('.bubble.me');
 assert.match(mine,/align-self:flex-end/);
 assert.match(mine,/background:var\(--iosOutgoing\)/);
 assert.match(mine,/color:#fff/);
 assert.match(mine,/border-bottom-right-radius:5px/);
});
test('Gemini responses use iPhone light-gray bubbles with readable dark text',()=>{
 assert.match(css,/--iosIncoming:#e9e9eb/);
 assert.match(css,/--iosIncomingInk:#1c1c1e/);
 const ai=rule('.bubble.ai');
 assert.match(ai,/align-self:flex-start/);
 assert.match(ai,/background:var\(--iosIncoming\)/);
 assert.match(ai,/color:var\(--iosIncomingInk\)/);
 assert.match(ai,/border-bottom-left-radius:5px/);
});
test('Gemini option cards match gray replies, error state remains distinct',()=>{
 assert.match(rule('.pick'),/background:var\(--iosIncoming\)/);
 assert.match(rule('.pick button'),/background:var\(--iosOutgoing\)/);
 assert.match(rule('.bubble.error'),/background:#fff5ef/);
 assert.match(html,/bubble\(message,'me'\)/);
 assert.match(html,/bubble\('Đang hiểu yêu cầu của anh\/chị…','ai'\)/);
});
