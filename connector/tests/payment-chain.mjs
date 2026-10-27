// Synthetic connector -> actual BotApi source -> fake Drive -> connector readback.
// No HTTP, credentials, Apps Script deployment, or real invoice is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import {callTool,tools} from '../lib/satori.mjs';
const root=new URL('../../',import.meta.url);
function fixture(){
 const secret='SYNTHETIC_ONLY_KEY_012345678901234567890123456789';
 const env={SATORI_BOT_API_URL:'https://script.google.com/macros/s/FAKE_NON_NETWORK/exec',SATORI_BOT_KEY_ID:'fixture-client',SATORI_BOT_SECRET:secret,SATORI_ENABLE_WRITES:'true'};
 const name='Khách giả lập — Nguyễn';
 let data={revision:1,values:{satori_orders_v15:JSON.stringify([
  {id:'fixture-A',invoiceNo:70001,name,total:125000,status:'Chưa thanh toán'},
  {id:'fixture-B',invoiceNo:70001,name:'Khách giả lập B',total:250000,status:'Chưa thanh toán'}
 ]),satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'}};
 let writes=0;const backups=[],cache=new Map();
 let scopes=['orders:read','payments:write'];
 const ctx={Date,JSON,Number,String,Object,Array,Math,Error,RegExp,
 readState_:()=>structuredClone(data),
 ContentService:{MimeType:{JSON:'json'},createTextOutput(text){return {text,setMimeType(){return this}}}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='STATE_FILE_ID'?'synthetic-file':k==='SATORI_BOT_CLIENTS_JSON'?JSON.stringify({'fixture-client':{enabled:true,secret,scopes}}):null})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{Charset:{UTF_8:'UTF_8'},computeHmacSha256Signature:(m,k,charset)=>{assert.equal(charset,'UTF_8');return [...createHmac('sha256',k).update(m,'utf8').digest()]},getUuid:randomUUID,formatDate:()=> '27/10/2026'},
 DriveApp:{getFileById:id=>{assert.equal(id,'synthetic-file');return {
 makeCopy(){const copy=JSON.stringify(data);backups.push(copy);return {getId:()=>`backup-${backups.length}`,getBlob:()=>({getDataAsString:()=>copy})}},
 setContent(raw){data=JSON.parse(raw);writes++}
 }}}
 };
 vm.createContext(ctx);vm.runInContext(readFileSync(new URL('accounting-core.js',root),'utf8'),ctx);vm.runInContext(readFileSync(new URL('api/BotApi.gs',root),'utf8'),ctx);
 const fetcher=async(url,options)=>{
  assert.equal(url,env.SATORI_BOT_API_URL);assert.ok(!options.body.includes(secret));
  assert.ok(/^[\x00-\x7f]*$/.test(options.body),'ASCII transport preserves UTF8 HMAC canonical message');
  return Response.json(JSON.parse(ctx.doPost({postData:{contents:options.body}}).text));
 };
 return {env,name,fetcher,read:()=>structuredClone(data),writes:()=>writes,backups,
 scope:v=>{scopes=v},
 payload:(requestId)=>({expectedRevision:data.revision,requestId,id:'fixture-A',invoiceNo:70001,expectedName:name,expectedTotal:125000,confirmed:true,reason:'Giả lập đối soát — không phải thanh toán thật'}),
 call:(tool,p,transport=fetcher)=>callTool(tool,p,env,transport)};
}
test('four advertised payment tools preserve customer/Satori independence through signed connector transport',async()=>{
 const f=fixture();for(const name of ['customer_paid','customer_unpaid','satori_paid','satori_unpaid'])assert.ok(tools(f.env).some(t=>t.name==='satori_mark_'+name));
 await f.call('satori_mark_satori_paid',f.payload('fixture-satori-001'));
 let list=await f.call('satori_orders_list',{query:'70001'});
 let a=list.data.orders.find(x=>x.id==='fixture-A');assert.equal(a.satoriPaid,true);assert.equal(a.customerPaid,false);
 await f.call('satori_mark_customer_paid',{expectedRevision:f.read().revision,id:'fixture-A',invoiceNo:70001,expectedName:f.name,expectedTotal:125000,confirmed:true,amount:125000});
 await f.call('satori_mark_satori_unpaid',f.payload('fixture-satori-002'));
 list=await f.call('satori_orders_list',{query:'70001'});a=list.data.orders.find(x=>x.id==='fixture-A');
 assert.equal(a.satoriPaid,false);assert.equal(a.customerPaid,true);
 await f.call('satori_mark_customer_unpaid',f.payload('fixture-customer-003'));
 list=await f.call('satori_orders_list',{query:'70001'});a=list.data.orders.find(x=>x.id==='fixture-A');
 assert.equal(a.satoriPaid,false);assert.equal(a.customerPaid,false);
 assert.equal(f.writes(),4);assert.equal(f.backups.length,4);
 const rows=JSON.parse(f.read().values.satori_orders_v15);assert.equal(rows[0].paymentAudit.length,3);
 assert.equal(rows[1].status,'Chưa thanh toán');assert.equal(rows[1].paymentAudit,undefined);
 assert.equal(JSON.parse(f.backups[0]).revision,1);
});
test('lost response after committed correction retries same request ID without another write',async()=>{
 const f=fixture(),p=f.payload('fixture-retry-001');
 await assert.rejects(()=>f.call('satori_mark_satori_paid',p,async(u,o)=>{await f.fetcher(u,o);throw Error('synthetic disconnect')}),/Chưa xác minh kết quả/);
 assert.equal(f.writes(),1);const result=await f.call('satori_mark_satori_paid',p);
 assert.equal(result.data.alreadyApplied,true);assert.equal(f.writes(),1);assert.equal(f.backups.length,1);
 await assert.rejects(()=>f.call('satori_mark_satori_unpaid',{...p,expectedRevision:2}),/REQUEST_ID_CONFLICT/);
});
test('missing scope, stale revision and wrong identity make zero fake Drive writes',async()=>{
 const f=fixture();f.scope(['orders:read']);
 await assert.rejects(()=>f.call('satori_mark_satori_paid',f.payload('fixture-denied-001')),/FORBIDDEN/);
 f.scope(['orders:read','payments:write']);
 await assert.rejects(()=>f.call('satori_mark_satori_paid',{...f.payload('fixture-stale-001'),expectedRevision:0}),/REVISION_CONFLICT/);
 await assert.rejects(()=>f.call('satori_mark_satori_paid',{...f.payload('fixture-wrong-001'),expectedName:'Wrong synthetic branch'}),/ORDER_CHANGED/);
 assert.equal(f.writes(),0);assert.equal(f.backups.length,0);
});
