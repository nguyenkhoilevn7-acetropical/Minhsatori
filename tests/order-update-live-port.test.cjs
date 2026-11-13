const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const {port}=require('../api/tools/port-order-updates-to-live.cjs');
const base=cp.execFileSync('git',['show','e8ab21c4:api/BotApi.gs'],{encoding:'utf8'});
const next=fs.readFileSync(__dirname+'/../api/BotApi.gs','utf8');
test('ports exact edit routes while preserving live-only read actions and owner bridge',()=>{
 const live=base.replace("var SCOPES={","var SCOPES={'pdf.get':'pdf:read',").replace('function read(s,action,p){',"function read(s,action,p){if(action==='pdf.get')return {livePdf:true};");
 const result=port(live,next,base);assert.ok(result.includes("'pdf.get':'pdf:read'"));assert.ok(result.includes("if(action==='pdf.get')return {livePdf:true};"));
 assert.ok(result.includes('function normalizeEditPrices('));assert.ok(result.includes("'orders.update':'orders:update'"));
 const getOwner=s=>s.slice(s.indexOf('function ownerMobileWrite('),s.indexOf('return {handle:handle'));
 assert.equal(getOwner(result),getOwner(live),'existing owner OAuth bridge byte-identical');
});
test('refuses a diverged live edit/auth function and refuses double porting',()=>{
 assert.throws(()=>port(base.replace('function auth(o){','function auth(o){var changed=true;'),next,base),/PORT_REFUSED/);
 assert.throws(()=>port(port(base,next,base),next,base),/PORT_REFUSED/);
});
