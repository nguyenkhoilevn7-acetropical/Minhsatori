import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=source('app.html');
const owner=source('owner-catalogue.html');
const script=(html,id)=> {
 const open='<script id="'+id+'">', start=html.indexOf(open);
 assert.ok(start>=0,'missing script '+id);
 const end=html.indexOf('</script>',start+open.length);
 assert.ok(end>start,'unclosed script '+id);
 return html.slice(start+open.length,end);
};

test('Pearl Glass adds a reversible layout to Gemini V2 and Owner without replacing markup',()=>{
 for(const html of [app,owner]){
  assert.equal((html.match(/id="satori-pearl-glass-style"/g)||[]).length,1);
  assert.equal((html.match(/id="satori-pearl-boot"/g)||[]).length,1);
  assert.equal((html.match(/id="satori-pearl-controls"/g)||[]).length,1);
  assert.match(html,/data-satori-layout-choice="classic"/);
  assert.match(html,/data-satori-layout-choice="pearl"/);
  assert.match(html,/satori\.ui\.layout\.v1/);
  assert.match(html,/@media screen/);
  assert.match(html,/prefers-reduced-motion:reduce/);
  assert.match(html,/prefers-reduced-transparency:reduce/);
  assert.doesNotThrow(()=>new vm.Script(script(html,'satori-pearl-boot')));
  assert.doesNotThrow(()=>new vm.Script(script(html,'satori-pearl-controls')));
 }
 assert.match(script(app,'satori-pearl-boot'),/s==='pearl'\|\|s==='classic'\?s:'pearl'/);
 assert.match(script(owner,'satori-pearl-boot'),/s==='pearl'\|\|s==='classic'\?s:'classic'/);
});

test('Gemini V2 shortcut cards reuse existing navigation handlers and do not issue orders',()=>{
 for(const dest of ['catalogue','addresses','orders']){
  assert.match(app,new RegExp('data-pearl-route="'+dest+'"'));
  assert.match(app,new RegExp('data-view="'+dest+'"'));
 }
 for(const id of ['chatView','message','send','cartView','cartLines','cartPriceSummary','submitTestOrder','ordersView','quoteResult','deliveryDialog']){
  assert.match(app,new RegExp('id="'+id+'"'));
 }
 const control=script(app,'satori-pearl-controls');
 assert.match(control,/nav\.click\(\)/);
 assert.doesNotMatch(control,/fetch\s*\(|\/api\/|submitTestOrder|orders\.create|orders\.update|payment/i);
});

test('Pearl styling is screen-only and invoice printing stays untouched',()=>{
 for(const html of [app,owner]){
  const style=html.match(/<style id="satori-pearl-glass-style">([\s\S]*?)<\/style>/)?.[1]||'';
  assert.ok(style.startsWith('\n/* PEARL GLASS'));
  assert.match(style,/html\[data-satori-layout="pearl"\]/);
  assert.doesNotMatch(style,/@media print|@page|\.pdf-filename/);
  assert.match(style,/color-scheme:light/);
  assert.match(style,/focus-visible/);
 }
 assert.match(owner,/id="crmConsole"/);
 assert.match(owner,/id="legacyConsole"/);
 assert.match(owner,/id="console"/);
 assert.match(owner,/id="ownerTabs"/);
});