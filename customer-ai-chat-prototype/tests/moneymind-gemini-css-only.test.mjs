import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const html=fs.readFileSync(path.join(here,'../index.html'),'utf8');
const fnv32=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193);return(h>>>0).toString(16).padStart(8,'0')};
test('Gemini MoneyMind visual release preserves exact production HTML/JS and invoice business logic',()=>{
 const business=html.replace(/<style>[\s\S]*?<\/style>/,'<style/>');
 assert.equal(fnv32(business),'ecebdaf8');
 assert.match(html,/MONEY-MIND FLAT DESIGN/);
 assert.match(html,/SATORI FULL-UI REVIEW/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.match(html,/\.brand-logo,\.chat-satori-logo,\.history-brand img\{object-fit:cover;border-radius:15px\}/);
 assert.ok(!html.includes('mm-legacy-nav')); // no extra navigation script in protected shell
});
