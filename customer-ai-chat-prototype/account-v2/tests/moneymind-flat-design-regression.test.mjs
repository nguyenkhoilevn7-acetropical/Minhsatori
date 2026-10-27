import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Baseline FNV32 fingerprints of the full HTML/JS body before theme-only changes.
const cases = [
  ['customer-v2', '../app.html', 'b8151169'],
  ['owner-catalogue', '../owner-catalogue.html', '12b23129'],
  ['admin', '../../admin.html', 'c5ef1108'],
  ['gemini-original', '../../index.html', 'a1544579'],
  ['synthetic-preview', '../../../ui-review/index.html', 'b627f658'],
];
function fnv32(source) {
  let h = 0x811c9dc5;
  for (let i=0; i<source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h>>>0).toString(16).padStart(8, '0');
}
function getCase(filename) {
  return readFileSync(new URL(filename, import.meta.url),'utf8');
}
// Only the new, inert navigation nodes may differ from the original MoneyMind
// CSS-only contract. Removing precisely those nodes must recover the original
// HTML+JS checksum; this protects all pre-existing invoice/identity workflows.
function stripNewNavigation(name,body){
  if(name==='customer-v2'){
    assert.match(body,/<nav class="mm-bottom-nav" aria-label="Điều hướng nhanh Minh Satori/);
    return body.replace(/<nav class="mm-bottom-nav"[\s\S]*?<\/nav>\n/, '');
  }
  if(name==='admin'){
    assert.match(body,/<nav class="mm-admin-bottom" aria-label="Thanh điều hướng Minh Satori/);
    return body.replace(/<nav class="mm-admin-bottom"[\s\S]*?<\/nav>\n/, '');
  }
  return body;
}
test('MoneyMind structure keeps original business DOM and JS byte-identical after extracting inert navigation',()=>{
  for(const [name,path,checksum] of cases) {
    const html=getCase(path);
    const styleEnd=html.indexOf('</style>');
    assert.ok(styleEnd>=0,name+' style block');
    const originalBody=stripNewNavigation(name,html.slice(styleEnd+8));
    assert.equal(fnv32(originalBody),checksum,name+': original DOM/JS must remain byte-identical');
    assert.match(html,/\/\* MONEY-MIND FLAT DESIGN/);
    assert.match(html,/#009c99/i,name+': teal palette');
    const start=html.indexOf('/* MONEY-MIND FLAT DESIGN');
    const finish=html.indexOf('/* END MONEY-MIND FLAT DESIGN */',start);
    assert.ok(finish>start,name+' theme marker');
    const css=html.slice(start,finish);
    assert.doesNotMatch(css,/<script|@import|url\s*\(\s*https?:|javascript:/i,name+': no external code');
  }
});
test('orders, customer/CTV permissions and Gemini links remain unchanged',()=>{
  const v2=getCase('../app.html');
  const admin=getCase('../../admin.html');
  const gemini=getCase('../../index.html');
  for(const name of ['/api/v2/me','/api/v2/cart','/api/v2/quote','/api/v2/orders'])assert.ok(v2.includes(name));
  for(const token of ['issued-links','ctv-ledger','customers','live','settings'])assert.match(admin,new RegExp('data-admin-tab="'+token+'"'));
  assert.match(gemini,/productionGeminiApp/);
  assert.match(v2,/data-view="orders"/);
  assert.match(v2,/id="referenceCartCount"/);
  assert.match(gemini,/id="quickCartNew"/);
});

test('MoneyMind bottom navigation cannot bypass existing authenticated view handlers',()=>{
  const v2=getCase('../app.html');
  const admin=getCase('../../admin.html');
  const bottomButtons=[...v2.matchAll(/<button\b[^>]*class="mm-bottom-tab[^"]*"[^>]*>/g)].map(x=>x[0]);
  const routeCounts = Object.fromEntries(['chat','catalogue','cart','orders','account']
    .map(route=>[route,bottomButtons.filter(tag=>tag.includes('data-view="'+route+'"')).length]));
  for(const [route,count] of Object.entries(routeCounts))assert.equal(count,1,route+' bottom navigation');
  assert.match(v2,/document\.querySelectorAll\('\[data-view\]'\)\.forEach\(btn=>btn\.onclick=\(\)=>view\(btn\.dataset\.view\)\)/);
  assert.match(v2,/#app:has\(#gate:not\(\.hidden\)\) \.mm-bottom-nav\{display:none\}/);
  for(const route of ['live','customers','issued-links','ctv-ledger','settings']) {
    assert.match(admin,new RegExp('class="mm-admin-tab[^"]*" data-admin-tab="'+route+'"'));
  }
  assert.match(admin,/document\.querySelectorAll\('\[data-admin-tab\]'\)/);
  assert.match(admin,/#workspace\{padding-bottom:76px\}/);
});
