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
test('MoneyMind CSS-only restyling keeps business DOM and JS byte-identical',()=>{
  for(const [name,path,checksum] of cases) {
    const html=getCase(path);
    const styleEnd=html.indexOf('</style>');
    assert.ok(styleEnd>=0,name+' style block');
    assert.equal(fnv32(html.slice(styleEnd+8)),checksum,name+': no DOM, JS, API, calculation or invoice changes');
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
