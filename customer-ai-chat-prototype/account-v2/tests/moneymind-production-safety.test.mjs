import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=[
 ['account-v2/app.html','4aa25fd7','mm-bottom-nav'],
 ['admin.html','f050de35','mm-admin-bottom']
];
const fnv32=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193);return (h>>>0).toString(16).padStart(8,'0')};
function businessOnly(html){
 return html.replace(/<style>[\s\S]*?<\/style>/,'<style/>')
  .replace(/<nav class="mm-(?:bottom-nav|admin-bottom)"[\s\S]*?<\/nav>\n/,'');
}
test('MoneyMind visual shell keeps the reviewed V2 unified-cart and delivery-note delta',()=>{
 // Reviewed 29/10: address/phone typography parity, catalogue direct quantity
 // selector and stable queued cart controls. Hashes intentionally updated after
 // verifying existing invoice/checkout security tests and isolated regression suite.
 // The current V2 build intentionally adds one accessible delivery-note field
 // and one delivery-note style to the original MoneyMind layout; freeze the
 // reviewed full-page business, CSS and non-script hashes to catch regressions.
 // Oct 28 reviewed delta: the owner-approved verified-ledger receipt adds one inline\n // chat card style and a guarded click action. Preserve the full-page hashes.
 const v2=fs.readFileSync(path.join(root,'account-v2/app.html'),'utf8');
 const fnvPart=x=>fnv32(x);
 assert.equal(fnvPart(v2.match(/<style>[\s\S]*?<\/style>/)?.[0]||''),'45b053eb');
 assert.equal(fnvPart(v2.replace(/<script>[\s\S]*?<\/script>/,'<script/>')),'6ebb7110');
 assert.match(v2,/\.delivery-dialog #agentAddressChoices \.agent-address-choice \.address-subtitle,/);
 assert.match(v2,/\.delivery-dialog #agentAddressChoices \.agent-address-choice \.address-phone \{/);
 assert.match(v2,/background:#eaf4f3;\s*color:#205e61;/);
 assert.match(v2,/result\.baseCartRevision!==cartRev/);
 for(const [file,expected,nav] of files){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  assert.equal(fnv32(businessOnly(html)),expected,file+' existing business source unexpectedly changed');
  assert.equal((html.match(new RegExp('<nav class="'+nav+'"','g'))||[]).length,1);
  assert.match(html,/prefers-reduced-motion:reduce/);
  assert.match(html,/MONEY-MIND FLAT DESIGN/);
 }
});
test('V2 navigation only targets original authorized views and never bypasses login gate',()=>{
 const html=fs.readFileSync(path.join(root,'account-v2/app.html'),'utf8');
 const nav=html.match(/<nav class="mm-bottom-nav"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),
   ['chat','catalogue','cart','orders','account']);
 assert.match(html,/#app:has\(#gate:not\(\.hidden\)\) \.mm-bottom-nav\{display:none\}/);
 assert.match(html,/document\.querySelectorAll\('\[data-view\]'\)/);
});
test('Admin navigation uses existing tab authorizations and hides with unauthenticated workspace',()=>{
 const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
 const nav=html.match(/<nav class="mm-admin-bottom"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.deepEqual([...nav.matchAll(/data-admin-tab="([^"]+)"/g)].map(m=>m[1]),
   ['live','customers','issued-links','ctv-ledger','settings']);
 assert.ok(html.indexOf('<nav class="mm-admin-bottom"')>html.indexOf('<div id="workspace" hidden>'));
 assert.match(html,/function showAdminTab\(name\)/);
});
