import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const asset=(tag,id)=>{const m=html.match(new RegExp('<'+tag+' id="'+id+'">([\\s\\S]*?)</'+tag+'>'));assert.ok(m,id);return m[1]};
const css=asset('style','satori-owner-liquid-v8-style');
const js=asset('script','satori-owner-liquid-v8-script');
test('Liquid Glass is a reversible owner-only preference, separate from shared customer layout',()=>{
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(js,/satori\.owner\.liquid\.v8/);
 assert.match(js,/satori\.owner\.liquid\.compact\.v8/);
 assert.match(js,/b\.dataset\.satoriLayoutChoice\)\{apply\(false\)/);
 assert.match(js,/place\.after\(nav\)/);
 assert.doesNotMatch(app,/satori-owner-liquid-v8/);
 assert.doesNotMatch(js,/fetch\s*\(|\/api\/|innerHTML\s*=|orders\.create|orders\.update/);
});
test('existing authenticated navigation and PDF actions are reused',()=>{
 for(const tab of ['new','old','catalogue'])assert.ok(html.includes('data-owner-tab="'+tab+'"'));
 for(const id of ['ownerTabs','ownerPdfToggle','refresh','s25-trigger'])assert.ok(js.includes(id));
 assert.match(js,/shell\.hidden=!on\|\|nav\.hidden/);
 assert.match(js,/target\.click\(\)/);
 assert.match(js,/attributeFilter:\['hidden','aria-selected'\]/);
 assert.match(html,/byId\('ownerTabs'\)\.hidden=false/);
});
test('glass optics, narrow screens and accessibility have scoped fallbacks',()=>{
 for(const token of ['backdrop-filter:blur','--lg-pill-y','--lg-x','prefers-reduced-motion:reduce','prefers-reduced-transparency:reduce','@media(max-width:899px)','safe-area-inset-bottom','focus-visible','@supports not','@media screen'])assert.ok(css.includes(token),token);
 assert.match(css,/html\[data-owner-liquid="on"\]/);
 assert.match(css,/#owner-liquid-shell\[hidden\]/);
});
