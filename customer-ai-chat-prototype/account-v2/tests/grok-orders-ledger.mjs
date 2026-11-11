/* Grok Phase B end to end: MCP HTTP -> V2 PostgreSQL drafts -> signed relay ->
 * the REAL Apps Script BotApi source running in a node:vm sandbox (fake Drive,
 * fake properties, synthetic customers). No network beyond 127.0.0.1, no real
 * ledger. Usage:
 *   SATORI_V2_CI_DATABASE_URL=postgresql://...127.0.0.1.../satori_v2_ci \
 *   SATORI_BOTAPI_SOURCE=<path to BotApi source> node account-v2/tests/grok-orders-ledger.mjs
 * SATORI_BOTAPI_SOURCE defaults to the repository api/BotApi.gs; a source without
 * orders.findByRequestId exits 2 (NOT RUN). Per-line VAT
 * scenarios need a source with optional per-line VAT (#410, live version 22);
 * against an older source they are reported as NOT RUN, never as passed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const url=process.env.SATORI_V2_CI_DATABASE_URL||'';
assert.ok(url.includes('127.0.0.1')&&/\/satori_v2_ci$/.test(url),'CI database only');
const sourcePath=process.env.SATORI_BOTAPI_SOURCE||path.join(root,'api/BotApi.gs');
const source=fs.readFileSync(sourcePath,'utf8');
const perLineSupported=source.includes('function normalizeInvoiceItems(');
// The V2 writer relay needs orders.findByRequestId (exact readback). A source
// without it cannot be the live ledger: report NOT RUN (exit 2), never a pass.
if(!source.includes('orders.findByRequestId')){
 console.log('NOT RUN: '+sourcePath+' has no orders.findByRequestId; set SATORI_BOTAPI_SOURCE to a live-equivalent BotApi source (clasp clone).');
 process.exit(2);
}

// ---- Fake Apps Script around the real BotApi source -------------------------
const READ_SECRET='fake_read_secret_0123456789abcdef0123456789',WRITE_SECRET='fake_write_secret_0123456789abcdef012345678';
let data={revision:1,updatedAt:'2026-11-12T00:00:00Z',values:{satori_orders_v15:'[]',satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]'}};
let seq=0,creates=0,dropNextCreateReply=false;
const cache=new Map();
const props={STATE_FILE_ID:'fake-file',SATORI_BOT_CLIENTS_JSON:JSON.stringify({
 'fake-read':{secret:READ_SECRET,enabled:true,scopes:['orders:read','customers:read']},
 'fake-v2-writer':{secret:WRITE_SECRET,enabled:true,scopes:['orders:read','orders:write']}})};
const ctx={Date,JSON,Number,String,Object,Array,Math,Error,RegExp,Set,Map,
 readState_:()=>JSON.parse(JSON.stringify(data)),
 ContentService:{MimeType:{JSON:'json'},createTextOutput(t){return {text:t,setMimeType(){return this}}}},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],getProperties:()=>({...props})})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k)??null,put:(k,v)=>cache.set(k,v)})},
 LockService:{getScriptLock:()=>({waitLock(){},tryLock:()=>true,releaseLock(){}})},
 Logger:{log(){}},console:{log(){},warn(){},error(){},info(){}},
 Utilities:{Charset:{UTF_8:'utf8'},getUuid:()=>crypto.randomUUID(),
  computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m).digest()],
  formatDate:()=> '12/11/2026'},
 DriveApp:{getFileById:()=>({makeCopy:()=>({getId:()=>'backup-'+(++seq),getBlob:()=>({getDataAsString:()=>JSON.stringify(data)})}),
  setContent(s){data=JSON.parse(s)}})}};
vm.createContext(ctx);
const core=path.join(root,'accounting-core.js');
if(fs.existsSync(core))vm.runInContext(fs.readFileSync(core,'utf8'),ctx);
vm.runInContext(source,ctx);
const ENDPOINT='https://script.google.com/macros/s/FAKE_'+'x'.repeat(40)+'/exec';
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(target,init={})=>{
 if(String(target)!==ENDPOINT)return nativeFetch(target,init);
 const body=JSON.parse(init.body);
 const out=ctx.doPost({postData:{contents:init.body}}).text;
 if(body.action==='orders.create'){creates++;if(dropNextCreateReply){dropNextCreateReply=false;throw new Error('fake lost reply')}}
 return new Response(out,{status:200,headers:{'content-type':'application/json'}});
};
Object.assign(process.env,{SATORI_READ_ENDPOINT:ENDPOINT,SATORI_READ_KEY_ID:'fake-read',SATORI_READ_HMAC_SECRET:READ_SECRET,
 SATORI_V2_CANONICAL_WRITES_ENABLED:'1',SATORI_V2_CANONICAL_WRITE_ENDPOINT:ENDPOINT,
 SATORI_V2_CANONICAL_WRITE_KEY_ID:'fake-v2-writer',SATORI_V2_CANONICAL_WRITE_SECRET:WRITE_SECRET,
 SATORI_GROK_MCP_ENABLED:'1',SATORI_GROK_MCP_TOKEN:crypto.randomBytes(32).toString('base64url')});
const ledger=()=>JSON.parse(data.values.satori_orders_v15);

// ---- V2 under test (in-process HTTP handler, real PostgreSQL) --------------
const {handleGrokMcpHttp}=await import('../grok-mcp.mjs');
const {readMinhSatori}=await import('../../satori-readonly.mjs');
const {createV2CanonicalRelay,ledgerRelayConfig}=await import('../canonical-ledger-relay.mjs');
const {ensureOwnerPushSchema}=await import('../owner-push.mjs');
const pool=new pg.Pool({connectionString:url,max:6});
let kicks=0;
const deps={reader:readMinhSatori,kick:()=>kicks++,
 relayFactory:()=>{ledgerRelayConfig(process.env);return createV2CanonicalRelay({env:process.env,fetcher:globalThis.fetch})}};
const http=await import('node:http');
const server=http.createServer((req,res)=>{
 handleGrokMcpHttp(req,res,new URL(req.url,'http://x').pathname,async()=>pool,process.env,deps)
  .then(h=>{if(!h){res.writeHead(404);res.end()}})
  .catch(()=>{res.writeHead(500);res.end()});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/mcp/grok/'+process.env.SATORI_GROK_MCP_TOKEN;
let rid=0;
const rpc=async(method,params)=>{
 const r=await nativeFetch(base,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++rid,method,params})});
 return (await r.json());
};
const tool=async(name,args)=>{const r=await rpc('tools/call',{name,arguments:args});return r.result};
const ok=r=>{assert.ok(!r.isError,JSON.stringify(r.content));return r.structuredContent};
const err=r=>{assert.equal(r.isError,true,JSON.stringify(r));return r.content[0].text};
const results=[];const pass=n=>{results.push(n);console.log('PASS',n)};
const wrongCode=c=>String((Number(c)+1)%10000).padStart(4,'0');

try{
 await ensureOwnerPushSchema(pool);
 await pool.query('TRUNCATE satori_v2_grok_order_drafts');

 // Disabled by default.
 process.env.GROK_OWNER_WRITES_ENABLED='';
 let names=(await rpc('tools/list')).result.tools.map(t=>t.name);
 assert.deepEqual(names,['satori_pending_pdf_deliveries','satori_mark_pdf_delivered']);
 assert.equal((await rpc('tools/call',{name:'satori_order_draft',arguments:{}})).error.code,-32602);
 pass('Order tools are hidden and uncallable unless GROK_OWNER_WRITES_ENABLED=1');
 process.env.GROK_OWNER_WRITES_ENABLED='1';
 names=(await rpc('tools/list')).result.tools.map(t=>t.name);
 assert.deepEqual(names.slice(2),['satori_find_customer','satori_order_draft','satori_order_confirm','satori_order_status']);

 // 1. New customer, invoice VAT 8% on goods, shipping not taxed.
 const d1=ok(await tool('satori_order_draft',{newCustomer:true,
  customer:{name:'Khách Giả Grok',phone:'0900 000 001',location:'01 Đường Giả, Quận Thử'},
  items:[{product:'Nước Giả 500ml',qty:3,unitPrice:95000,listPrice:120000},{product:'Nước Giả 1.5L',unit:'Lốc',qty:2,unitPrice:62500}],
  shippingAmount:30000,vatRate:8}));
 assert.equal(d1.breakdown.goods,410000);assert.equal(d1.breakdown.vat,32800);assert.equal(d1.total,472800);
 assert.equal(d1.breakdown.vatMode,'invoice');assert.match(d1.summary,/TỔNG: 472\.800 đ/);assert.match(d1.summary,/KHÁCH MỚI/);
 assert.equal(ledger().length,0,'draft writes nothing');
 pass('Draft prices server-side (invoice VAT 8% on goods only), writes nothing to the ledger');

 assert.match(err(await tool('satori_order_confirm',{draftId:d1.draftId,approvalCode:wrongCode(d1.approvalCode)})),/WRONG_CODE/);
 assert.equal(ledger().length,0);
 const c1=ok(await tool('satori_order_confirm',{draftId:d1.draftId,approvalCode:d1.approvalCode}));
 assert.equal(c1.state,'COMMITTED');assert.equal(c1.invoiceNo,1);assert.equal(c1.total,472800);assert.equal(kicks,1);
 const inv1=ledger()[0];
 assert.equal(inv1.total,472800);assert.equal(inv1.vatAmount,32800);assert.equal(inv1.shippingAmount,30000);
 assert.equal(inv1.items[1].unit,'Lốc');assert.equal(inv1.items[0].listPrice,120000);assert.ok(!inv1.vatMode||inv1.vatMode==='invoice');
 assert.equal(inv1.source,'bot_api');assert.equal(inv1.status,'Chưa thanh toán');
 pass('Wrong code writes nothing; right code -> exactly one signed orders.create, exact readback, push kicked');

 const again=ok(await tool('satori_order_confirm',{draftId:d1.draftId,approvalCode:d1.approvalCode}));
 assert.equal(again.invoiceNo,1);assert.equal(again.duplicate,true);assert.equal(ledger().length,1);assert.equal(creates,1);
 pass('Re-confirming a committed draft returns the same invoice, no second create');

 // 2. Existing customer via find + customerRef; mismatched destination rejected at draft time.
 const found=ok(await tool('satori_find_customer',{query:'0900000001'}));
 assert.equal(found.count,1);assert.deepEqual(found.customers[0].customerRef,{id:inv1.id,invoiceNo:1});
 assert.match(err(await tool('satori_order_draft',{customerRef:found.customers[0].customerRef,
  customer:{name:'Khách Giả Grok',phone:'0900000001',location:'Địa chỉ khác'},items:[{product:'Nước Giả 500ml',qty:1,unitPrice:95000}]})),/PROFILE_MISMATCH/);
 assert.match(err(await tool('satori_order_draft',{customer:{name:'Ai Đó',location:'99 Đường Giả'},items:[{product:'Nước Giả',qty:1,unitPrice:1}]})),/PROFILE_CONFIRMATION_REQUIRED/);
 const d2=ok(await tool('satori_order_draft',{customerRef:found.customers[0].customerRef,
  customer:{name:'khach gia grok',phone:'0900-000-001',location:'01 Đường Giả, Quận Thử'},items:[{product:'Nước Giả 500ml',qty:1,unitPrice:95000}],deliveryDate:'2026-11-13'}));
 // Lost HTTP reply after the ledger wrote: UNCERTAIN, then status reconciles to the same invoice.
 dropNextCreateReply=true;
 const lost=ok(await tool('satori_order_confirm',{draftId:d2.draftId,approvalCode:d2.approvalCode}));
 assert.ok(['COMMITTED','UNCERTAIN'].includes(lost.state));
 const st=ok(await tool('satori_order_status',{draftId:d2.draftId}));
 assert.equal(st.state,'COMMITTED');assert.equal(st.invoiceNo,2);assert.equal(ledger().length,2);assert.equal(creates,2);
 const retry=ok(await tool('satori_order_confirm',{draftId:d2.draftId,approvalCode:d2.approvalCode}));
 assert.equal(retry.invoiceNo,2);assert.equal(ledger().length,2);assert.equal(creates,2);
 assert.equal(ledger()[0].deliveryDate,'2026-11-13');
 pass('Existing customer via customerRef (accent/format-insensitive); lost reply reconciles to ONE invoice');

 // 3. Concurrency: 10 parallel confirms of one draft -> one invoice.
 const d3=ok(await tool('satori_order_draft',{newCustomer:true,customer:{name:'Khách Song Song',location:'02 Đường Giả'},
  items:[{product:'Nước Giả 500ml',qty:5,unitPrice:90000}]}));
 const many=await Promise.all(Array.from({length:10},()=>tool('satori_order_confirm',{draftId:d3.draftId,approvalCode:d3.approvalCode})));
 assert.equal(ledger().filter(o=>o.name==='Khách Song Song').length,1);
 assert.ok(many.some(r=>!r.isError&&r.structuredContent.state==='COMMITTED'));
 assert.ok(many.every(r=>!r.isError?r.structuredContent.invoiceNo===3:/DRAFT_CLOSED/.test(r.content[0].text)));
 pass('10 simultaneous confirms of one draft -> exactly one invoice');

 // 4. Brute force: 5 wrong codes cancel the draft.
 const d4=ok(await tool('satori_order_draft',{newCustomer:true,customer:{name:'Khách Dò Mã',location:'03 Đường Giả'},items:[{product:'Nước Giả',qty:1,unitPrice:1000}]}));
 for(let i=0;i<5;i++)err(await tool('satori_order_confirm',{draftId:d4.draftId,approvalCode:wrongCode(d4.approvalCode)}));
 assert.match(err(await tool('satori_order_confirm',{draftId:d4.draftId,approvalCode:d4.approvalCode})),/DRAFT_CLOSED/);
 await pool.query("UPDATE satori_v2_grok_order_drafts SET expires_at=now()-interval '1 minute' WHERE id=$1",[d3.draftId]);
 const d5=ok(await tool('satori_order_draft',{newCustomer:true,customer:{name:'Khách Hết Hạn',location:'04 Đường Giả'},items:[{product:'Nước Giả',qty:1,unitPrice:1000}]}));
 await pool.query("UPDATE satori_v2_grok_order_drafts SET expires_at=now()-interval '1 minute' WHERE id=$1",[d5.draftId]);
 assert.match(err(await tool('satori_order_confirm',{draftId:d5.draftId,approvalCode:d5.approvalCode})),/DRAFT_EXPIRED/);
 assert.equal(ledger().filter(o=>/Dò Mã|Hết Hạn/.test(o.name)).length,0);
 pass('5 wrong codes cancel the draft; expired drafts cannot be confirmed; nothing written');

 // 5. Revision moved between draft and confirm (another device wrote): still exactly one invoice.
 const d6=ok(await tool('satori_order_draft',{newCustomer:true,customer:{name:'Khách Revision',location:'05 Đường Giả'},items:[{product:'Nước Giả',qty:2,unitPrice:5000}]}));
 data.revision+=7;
 const c6=ok(await tool('satori_order_confirm',{draftId:d6.draftId,approvalCode:d6.approvalCode}));
 assert.equal(c6.state,'COMMITTED');assert.equal(ledger().filter(o=>o.name==='Khách Revision').length,1);
 pass('Confirm reads the CURRENT ledger revision, so other writes in between do not block or duplicate');

 // 6. Optional per-line VAT (exempt line, custom rate, half-up rounding).
 if(perLineSupported){
  const d7=ok(await tool('satori_order_draft',{newCustomer:true,customer:{name:'Khách VAT Dòng',location:'06 Đường Giả'},vatRate:8,
   items:[{product:'Nước Giả 500ml',qty:1,unitPrice:100000},{product:'Tiền Cọc Vỏ',qty:1,unitPrice:10,vatExempt:true},
    {product:'Hàng Lẻ 10%',qty:1,unitPrice:5,vatRate:10}],shippingAmount:2000}));
  assert.deepEqual([d7.breakdown.vat,d7.total,d7.breakdown.vatMode],[8001,110016,'per_line']);
  const c7=ok(await tool('satori_order_confirm',{draftId:d7.draftId,approvalCode:d7.approvalCode}));
  const inv7=ledger().find(o=>o.invoiceNo===c7.invoiceNo);
  assert.equal(inv7.vatMode,'per_line');assert.equal(inv7.vatAmount,8001);assert.equal(inv7.total,110016);
  assert.deepEqual(inv7.items.map(i=>[i.vatExempt,i.vatRate,i.vatAmount]),[[false,8,8000],[true,0,0],[false,10,1]]);
  assert.match(err(await tool('satori_order_draft',{newCustomer:true,customer:{name:'Thiếu VAT',location:'07 Đường Giả'},
   items:[{product:'Có VAT',qty:1,unitPrice:100,vatRate:8},{product:'Không Rõ',qty:1,unitPrice:100}]})),/VAT_RATE_REQUIRED/);
  pass('Per-line VAT (exempt, 10% line, half-up 0.5 đ) matches the live ledger exactly');
 }else console.log('NOT RUN: per-line VAT scenarios (source has no optional per-line VAT): '+sourcePath);

 // 7. Writer not configured: fails before claiming, draft stays usable.
 const d8=ok(await tool('satori_order_draft',{newCustomer:true,customer:{name:'Khách Chưa Bật',location:'08 Đường Giả'},items:[{product:'Nước Giả',qty:1,unitPrice:1000}]}));
 process.env.SATORI_V2_CANONICAL_WRITES_ENABLED='0';
 assert.match(err(await tool('satori_order_confirm',{draftId:d8.draftId,approvalCode:d8.approvalCode})),/WRITER_NOT_READY/);
 process.env.SATORI_V2_CANONICAL_WRITES_ENABLED='1';
 assert.equal(ok(await tool('satori_order_confirm',{draftId:d8.draftId,approvalCode:d8.approvalCode})).state,'COMMITTED');
 pass('Missing writer config fails closed before the draft is claimed; later confirm still works once');

 const nos=ledger().map(o=>o.invoiceNo);
 assert.equal(new Set(nos).size,nos.length,'no duplicate invoice numbers');
 assert.equal(creates,ledger().length+0,'one orders.create per invoice');
 console.log('PASS grok order suite: '+results.length+' scenarios against '+path.basename(sourcePath)+(perLineSupported?' (per-line VAT)':''));
}finally{
 server.close();await pool.end();
}
