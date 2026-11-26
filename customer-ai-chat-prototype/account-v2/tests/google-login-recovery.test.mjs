import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
test('customer login keeps verified Google credential and approval path',()=>{
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.match(script,/call\('\/api\/v2\/auth\/google',\{credential:result\.credential\}\)/);
 assert.match(script,/google\.accounts\.id\.renderButton/);
});
test('embedded browser recovery avoids starting GIS, and external GIS loading is bounded',()=>{
 const start=script.indexOf('  const embedded=');
 const end=script.indexOf('   google.accounts.id.initialize',start);
 assert.ok(start>=0&&end>start);
 const code=script.slice(start,end)+'   window.started=true;\n  };\n  init();';
 const run=(ua,ready)=>{
  const elements={};
  const el=()=>({style:{},setAttribute(){},append(){},insertAdjacentElement(){},focus(){},select(){},setSelectionRange(){}});
  const ctx={navigator:{userAgent:ua},location:{origin:'https://example.test'},document:{createElement:el},
   $:id=>elements[id]||(elements[id]=el()),window:ready?{google:{accounts:{id:{}}}}:{},setTimeout:fn=>fn()};
  vm.runInNewContext(code,ctx);
  return {ctx,elements};
 };
 const embedded=run('Mozilla/5.0 iPhone Zalo',true);
 assert.equal(embedded.ctx.window.started,undefined);
 assert.match(embedded.elements.loginStatus.textContent,/Safari hoặc Chrome/);
 assert.equal(run('Mozilla/5.0 iPhone Safari',true).ctx.window.started,true);
 const stalled=run('Mozilla/5.0 iPhone Safari',false);
 assert.equal(stalled.ctx.window.started,undefined);
 assert.match(stalled.elements.loginStatus.textContent,/Google chưa tải được/);
});
