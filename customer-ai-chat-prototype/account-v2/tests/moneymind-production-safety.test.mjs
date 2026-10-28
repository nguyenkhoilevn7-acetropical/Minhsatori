import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=[
 ['account-v2/app.html','0864c5e0','mm-bottom-nav'],
 ['admin.html','f050de35','mm-admin-bottom']
];
const fnv32=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193);return (h>>>0).toString(16).padStart(8,'0')};
function businessOnly(html){
 return html.replace(/<style>[\s\S]*?<\/style>/,'<style/>')
  .replace(/<nav class="mm-(?:bottom-nav|admin-bottom)"[\s\S]*?<\/nav>\n/,'');
}
test('MoneyMind production must keep existing business HTML and all scripts byte identical',()=>{
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
