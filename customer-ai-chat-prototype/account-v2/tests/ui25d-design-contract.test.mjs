import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,BASE),'utf8');

for (const page of ['app.html','owner-catalogue.html']) {
 test('UI25D responsive, persistent theme and safe UI scope in '+page,()=>{
  const html=read(page);
  assert.match(html,/satori\.ui\.v25d/);
  assert.match(html,/data-s25-depth/);
  assert.match(html,/data-s25-swatch/);
  assert.match(html,/s25-custom/);
  assert.match(html,/prefers-reduced-motion/);
  assert.match(html,/--s25-shadow/);
  assert.match(html,/\.drawer\{background/);
  assert.match(html,/body:not\(\.menu-open\) \.drawer/);
  assert.match(html,/Never reads or modifies invoices, auth, cart, chat, or API/);
  assert.equal((html.match(/id='s25-panel'/g)||[]).length,0);
 });
}
test('Original Gemini and customer order controls remain present',()=>{
 const app=read('app.html');
 for(const id of ['chatView','messages','cartView','cartLines','message','send','ownerPanel']){
  assert.match(app,new RegExp('id="'+id+'"'),'missing '+id);
 }
 assert.match(app,/Gemini/);
});
test('Owner CRM and catalogue remain present',()=>{
 const html=read('owner-catalogue.html');
 for(const id of ['crmConsole','legacyConsole','console','ownerTabs']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
});
