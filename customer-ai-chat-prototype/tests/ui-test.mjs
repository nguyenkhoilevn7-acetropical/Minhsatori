/* Static UI compile / accessibility smoke test. No browser, no user data, no external requests. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,'inline app script exists');
new vm.Script(match[1],{filename:'customer-chat-inline.js'});
for(const [needle,description] of [
 ['id="allProductsButton"','All Products menu button'],
 ['id="catalogBackdrop"','catalogue overlay'],
 ['id="catalogSearch"','catalogue search'],
 ['id="catalogFilters"','brand filters'],
 ['id="catalogItems"','product item list'],
 ['id="selectedQuantity"','quantity selector'],
 ["fetch('/api/catalogue?token='","server-driven product list"],
 ['bubble.user','iMessage-style user messages'],
 ['.bubble.assistant','assistant message styling'],
 ['@media(max-width:760px)','mobile CSS'],
 ["serverPost('/api/confirm'","customer confirmation before new order"]
])assert.ok(html.includes(needle),description);
assert.ok(html.trim().endsWith('</html>'),'complete HTML document');
assert.ok(!html.includes('GEMINI_API_KEY'),'never inline API secrets');
console.log('PASS 14/14 iMessage UI structure and JavaScript syntax smoke checks');
