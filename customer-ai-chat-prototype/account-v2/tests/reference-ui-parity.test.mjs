import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const files={
  v2:new URL('../app.html',import.meta.url),
  admin:new URL('../../admin.html',import.meta.url),
  classicGemini:new URL('../../index.html',import.meta.url),
  owner:new URL('../owner-catalogue.html',import.meta.url)
};
const read=(key)=>readFileSync(files[key],'utf8');
const scripts=s=>s.slice(s.indexOf('</style>')+8);
test('all website and both Gemini surfaces keep the shared visual reference theme',()=>{
  for(const key of Object.keys(files)){
    const html=read(key);
    assert.match(html,/SATORI FULL-UI REVIEW/,key);
    assert.match(html,/#086fdf|#0875e6/,key);
    assert.match(html,/<\/body>\s*<\/html>/i,key);
    assert.equal((html.match(/<style>/g)||[]).length,1,key);
    assert.equal((html.match(/<\/style>/g)||[]).length,1,key);
  }
});
test('all functional website scripts are still present',()=>{
 const v2=scripts(read('v2'));
 const admin=scripts(read('admin'));
 const classic=scripts(read('classicGemini'));
 for(const token of ['/api/v2/me','/api/v2/cart','/api/v2/quote','/api/v2/orders']){
   assert.ok(v2.includes(token),token);
 }
 for(const token of ['id="messages"','id="signIn"','id="previewBanner"']){
   assert.ok(v2.includes(token),token);
 }
 for(const token of ['data-admin-tab="customers"','data-admin-tab="issued-links"',
   'data-admin-tab="live"','id="newOrderCount"']){
   assert.ok(admin.includes(token),token);
 }
 // These selectors are part of the production Gemini styling shell;
 // the actual customer chat is dynamically mounted, not static body markup.
 assert.match(read('classicGemini'),/productionGeminiApp/);
 assert.match(read('classicGemini'),/quickCartCount/);
 assert.match(read('classicGemini'),/real-submitted-card/);
});
test('all V2 and admin navigation buttons are icon-led with original tab IDs',()=>{
 const v2=read('v2'),admin=read('admin');
 for(const route of ['chat','catalogue','addresses','orders','account']){
   assert.ok(v2.includes('data-view="'+route+'"'),'missing account view '+route);
 }
 for(const route of ['orders','live','customers','ctv-ledger','issued-links','changes','settings']){
   const start=admin.indexOf('data-admin-tab="'+route+'"');
   assert.ok(start>=0,'missing admin tab '+route);
   const tail=admin.slice(start,Math.min(admin.length,start+450));
   assert.match(tail,/<svg /,'admin outline icon for '+route);
 }
 assert.ok(v2.includes('class="nav active" data-view="chat"><svg'));
 assert.ok(v2.includes('data-view="orders"><svg'));
});
test('invoice and ownership are still guarded, no new external image/script sources',()=>{
 const v2=read('v2'),admin=read('admin'),gemini=read('classicGemini');
 assert.match(v2,/chat-order-receipt/);
 assert.match(v2,/agent-address-choice/);
 assert.match(admin,/directory-card/);
 assert.match(admin,/issued-link-card/);
 assert.match(gemini,/production-gemini/);
 for(const html of [v2,admin,gemini]){
  const start=html.lastIndexOf('/* SATORI FULL-UI REVIEW');
  const end=html.indexOf('/* END SATORI FULL-UI REVIEW */',start);
  assert.ok(start>=0&&end>start,'theme marker exists');
  assert.doesNotMatch(html.slice(start,end),/<script|@import|url\(https?:/,
    'visual-only style must not add network or script dependencies');
 }
});
