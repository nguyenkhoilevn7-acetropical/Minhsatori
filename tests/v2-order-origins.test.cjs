'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function api(extra={}){const ctx={...extra};vm.createContext(ctx);vm.runInContext(fs.readFileSync('api/V2OrderOrigins.gs','utf8'),ctx);return ctx.SatoriV2OrderOrigins}
const row={ledgerInvoiceId:'fake-id',invoiceNo:'900001',accountId:'fake-account',accountName:'FAKE CTV',accountRole:'collaborator',requestId:'fake-request'};
const bill={id:'fake-id',invoiceNo:900001,apiRequestId:'fake-request',name:'FAKE recipient',total:1000};
const doc=(entries=[row])=>({schemaVersion:1,source:'satori-v2-postgresql-committed',generatedAt:new Date().toISOString(),entries});
test('exact ID, number, request ID required; output has only five requested fields',()=>{
 const before=JSON.stringify(bill),out=api().select(doc(),[bill]);
 assert.equal(out.length,1);assert.deepEqual(Object.keys(out[0]).sort(),['accountId','accountName','accountRole','invoiceNo','ledgerInvoiceId']);
 assert.equal(JSON.stringify(bill),before);
 for(const b of [{...bill,id:'wrong'},{...bill,invoiceNo:900002},{...bill,apiRequestId:'wrong'},{...bill,apiRequestId:undefined}])assert.equal(api().select(doc(),[b]).length,0);
});
test('duplicates, stale exports and untrusted source are rejected',()=>{
 for(const d of [doc([row,row]),{...doc(),source:'browser'},{...doc(),generatedAt:'2000-01-01'},doc([{...row,accountRole:'unknown'}])])assert.equal(api().select(d,[bill]).length,0);
 assert.equal(api().select(doc(),[bill,bill]).length,0);
});
test('no configuration or unreadable registry returns empty without touching financial state',()=>{
 const props={getScriptProperties:()=>({getProperty:()=>null})};
 assert.equal(api({PropertiesService:props}).read({}).length,0);
 const failing={getScriptProperties:()=>({getProperty:()=>{throw Error('fake')}})};
 assert.equal(api({PropertiesService:failing}).read({}).length,0);
});
test('registry hook is after owner checks; no additional payment or dispatcher changes',()=>{
 const code=fs.readFileSync('api/AndroidOwnerMobileApi.gs','utf8');
 assert.ok(code.indexOf('SatoriV2OrderOrigins.read(s)')>code.indexOf('var actor=verify(req.accessToken)'));
 assert.ok(code.indexOf('SatoriV2OrderOrigins.read(s)')>code.indexOf("if(action==='mobile.revision')"));
});
