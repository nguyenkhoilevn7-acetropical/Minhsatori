// Offline unit tests for Grok Phase B pricing and gating. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {priceOwnerOrder,draftSummary,vatBasisPoints,norm,GrokOrderError,createDraft,confirmDraft} from '../grok-orders.mjs';
import {grokToolList,GROK_TOOLS,handleGrokRpc} from '../grok-mcp.mjs';

const base=(x={})=>({customer:{name:'Khách Giả',location:'01 Đường Giả'},items:[{product:'Nước Giả',qty:3,unitPrice:95000}],...x});
const code=(f)=>{try{f();return 'NO_ERROR'}catch(e){assert.ok(e instanceof GrokOrderError,String(e));return e.code}};

test('no VAT unless asked; shipping is never taxed',()=>{
 const {order,breakdown}=priceOwnerOrder(base({shippingAmount:30000}));
 assert.deepEqual([breakdown.goods,breakdown.vat,breakdown.total,breakdown.vatMode],[285000,0,315000,'none']);
 assert.equal(order.vatAmount,0);assert.equal(order.total,315000);assert.ok(!('vatRate' in order));
 assert.deepEqual(order.items[0],{code:'',product:'Nước Giả',unit:'Thùng',qty:3,unitPrice:95000,listPrice:95000});
});
test('order vatRate without line fields = historic invoice VAT on goods (no vatRate sent)',()=>{
 const {order,breakdown}=priceOwnerOrder(base({vatRate:8,shippingAmount:30000,
  items:[{product:'A Giả',qty:3,unitPrice:95000},{product:'B Giả',qty:2,unitPrice:62500}]}));
 assert.deepEqual([breakdown.goods,breakdown.vat,breakdown.total,breakdown.vatMode],[410000,32800,472800,'invoice']);
 assert.equal(order.vatAmount,32800);assert.ok(!('vatRate' in order));assert.ok(order.items.every(i=>!('vatAmount' in i)));
 assert.equal(priceOwnerOrder(base({vatRate:8,items:[{product:'Lẻ',qty:1,unitPrice:13}]})).order.vatAmount,1,'1.04 -> 1');
 assert.equal(priceOwnerOrder(base({vatRate:10,items:[{product:'Lẻ',qty:1,unitPrice:5}]})).order.vatAmount,1,'0.5 -> 1 half-up');
});
test('per-line VAT: exempt > line rate > order rate, half-up per line, summed once',()=>{
 const {order,breakdown}=priceOwnerOrder(base({vatRate:8,shippingAmount:2000,items:[
  {product:'Nước Giả',qty:1,unitPrice:100000},{product:'Cọc Vỏ',qty:1,unitPrice:10,vatExempt:true,vatRate:10},
  {product:'Lẻ 10%',qty:1,unitPrice:5,vatRate:10}]}));
 assert.deepEqual([breakdown.vat,breakdown.total,breakdown.vatMode],[8001,110016,'per_line']);
 assert.equal(order.vatRate,8);assert.equal(order.vatAmount,8001);
 assert.deepEqual(order.items.map(i=>[i.vatExempt,i.vatRate,i.vatAmount]),[[undefined,undefined,8000],[true,undefined,0],[undefined,10,1]]);
 assert.equal(code(()=>priceOwnerOrder(base({items:[{product:'Có',qty:1,unitPrice:1,vatRate:8},{product:'Không rõ',qty:1,unitPrice:1}]}))),'VAT_RATE_REQUIRED');
});
test('money and identity inputs fail closed',()=>{
 for(const [x,c] of [
  [{items:[{product:'A Giả',qty:1.5,unitPrice:1}]},'INVALID_ITEM'],[{items:[{product:'A Giả',qty:1,unitPrice:1.5}]},'INVALID_AMOUNT'],
  [{items:[{product:'A Giả',qty:1,unitPrice:-1}]},'INVALID_AMOUNT'],[{items:[]},'INVALID_ORDER'],
  [{items:[{product:'A',qty:1,unitPrice:1}]},'INVALID_ITEM'],[{vatRate:8.001},'INVALID_TAX_RATE'],[{vatRate:101},'INVALID_TAX_RATE'],
  [{shippingAmount:'30000'},'INVALID_AMOUNT'],[{customer:{name:'A'}},'INVALID_ORDER'],[{deliveryDate:'2026-02-30'},'INVALID_ORDER'],
  [{items:[{product:'A Giả',qty:1,unitPrice:1,vatExempt:'true'}]},'INVALID_TAX_RATE'],
  [{items:[{product:'A Giả',qty:100001,unitPrice:1}]},'INVALID_ITEM']])
  assert.equal(code(()=>priceOwnerOrder(base(x))),c,JSON.stringify(x));
 assert.equal(vatBasisPoints(8.25),825);assert.equal(norm(' Khách ĐẶNG Treky '),'khach dang traky');
});
test('summary states every amount the owner approves, and no approval code',()=>{
 const p=priceOwnerOrder(base({vatRate:8,shippingAmount:30000,deliveryDate:'2026-11-13'}));
 const s=draftSummary(p,'KHÁCH MỚI');
 for(const re of [/ĐƠN NHÁP \(chưa ghi sổ\)/,/Nước Giả — 3 Thùng × 95\.000 đ = 285\.000 đ/,/VAT 8% trên tiền hàng: 22\.800 đ/,
  /Phí giao: 30\.000 đ/,/TỔNG: 337\.800 đ/,/Ngày giao: 2026-11-13/])assert.match(s,re);
 assert.doesNotMatch(s,/Mã duyệt/);
});
test('order tools are listed only when GROK_OWNER_WRITES_ENABLED=1',()=>{
 assert.deepEqual(grokToolList({}),GROK_TOOLS);assert.deepEqual(grokToolList({GROK_OWNER_WRITES_ENABLED:'true'}),GROK_TOOLS);
 const listed=grokToolList({GROK_OWNER_WRITES_ENABLED:'1'});
 assert.deepEqual(listed.map(t=>t.name).slice(2,6),
  ['satori_find_customer','satori_order_draft','satori_order_confirm','satori_order_status']);
 assert.ok(!JSON.stringify(listed).match(/payment|delete|markPaid/i));
 const draft=listed.find(t=>t.name==='satori_order_draft');
 const confirm=listed.find(t=>t.name==='satori_order_confirm');
 assert.match(draft.description,/ok/);
 assert.match(confirm.description,/ok/);
 // approvalCode appears ONLY as the optional legacy property of satori_order_confirm.
 assert.ok(!JSON.stringify(listed.filter(t=>t.name!=='satori_order_confirm')).match(/approvalCode/i));
 assert.doesNotMatch(confirm.description,/approvalCode|mã duyệt/i);
});
test('confirm schema accepts legacy approvalCode as optional, unconstrained string',()=>{
 const confirm=grokToolList({GROK_OWNER_WRITES_ENABLED:'1'}).find(t=>t.name==='satori_order_confirm');
 const s=confirm.inputSchema;
 assert.equal(s.type,'object');
 assert.equal(s.additionalProperties,false);
 assert.deepEqual(s.required,['draftId']);
 assert.deepEqual(Object.keys(s.properties).sort(),['approvalCode','draftId']);
 assert.equal(s.properties.approvalCode.type,'string');
 assert.equal(s.properties.approvalCode.pattern,undefined);
 assert.equal(s.properties.approvalCode.minLength,undefined);
 assert.equal(s.properties.approvalCode.maxLength,undefined);
 assert.match(s.properties.approvalCode.description,/Trường cũ, bị bỏ qua/);
});

/** In-memory stand-in for the draft table. No network and no PostgreSQL. */
function memoryDrafts(){
 const rows=new Map();
 const run=async(sql,params=[])=>{
  const q=sql.replace(/\s+/g,' ').trim();
  if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK')return {rows:[],rowCount:0};
  if(q.startsWith('INSERT INTO satori_v2_grok_order_drafts')){
   const [id,requestId,codeHash,customerRef,orderPayload,summary,mins]=params;
   rows.set(id,{id,request_id:requestId,code_hash:codeHash,
    customer_ref:customerRef==null?null:JSON.parse(customerRef),order_payload:JSON.parse(orderPayload),
    summary,status:'draft',invoice_no:null,ledger_id:null,last_note:null,code_attempts:0,
    expires_at:new Date(Date.now()+Number(mins)*60000),approved_at:null,updated_at:new Date()});
   return {rows:[],rowCount:1};
  }
  if(q.startsWith('SELECT *,expires_at<now() AS expired FROM satori_v2_grok_order_drafts WHERE id=$1')){
   const row=rows.get(params[0]);
   if(!row)return {rows:[],rowCount:0};
   return {rows:[{...row,order_payload:{...row.order_payload},expired:row.expires_at.getTime()<Date.now()}],rowCount:1};
  }
  if(q.startsWith("UPDATE satori_v2_grok_order_drafts SET status='submitting'")){
   const row=rows.get(params[0]);
   row.status='submitting';row.approved_at=row.approved_at||new Date();row.updated_at=new Date();
   return {rows:[],rowCount:1};
  }
  if(q.startsWith('UPDATE satori_v2_grok_order_drafts SET status=$2')){
   const row=rows.get(params[0]);
   row.status=params[1];row.invoice_no=params[2];row.ledger_id=params[3];row.last_note=params[4];row.updated_at=new Date();
   return {rows:[],rowCount:1};
  }
  throw new Error('unexpected SQL: '+q);
 };
 return {rows,query:run,connect:async()=>({query:run,release(){}})};
}
const reader=async action=>{assert.equal(action,'system.status');return {revision:3}};
const newOrder=()=>base({newCustomer:true});

test('draft returns summary and draftId with no approval code',async()=>{
 const pool=memoryDrafts();
 const d=await createDraft(pool,()=>{throw new Error('draft must not read the ledger')},newOrder());
 assert.equal(Object.hasOwn(d,'approvalCode'),false);
 assert.match(d.draftId,/^[0-9a-f-]{36}$/);
 assert.match(d.summary,/TỔNG: 285\.000 đ/);
 assert.doesNotMatch(d.summary,/Mã duyệt/);
 assert.match(d.instruction,/ok/);
 assert.equal(pool.rows.size,1);
 const row=[...pool.rows.values()][0];
 assert.equal(row.code_hash,'0'.repeat(64));
 assert.equal(row.status,'draft');
 assert.equal(row.invoice_no,null);
 const again=await createDraft(pool,()=>{throw new Error('draft must not read the ledger')},newOrder());
 assert.equal(pool.rows.get(again.draftId).code_hash,row.code_hash);
 assert.equal(JSON.stringify(d).includes(row.code_hash),false);
});

test('confirm with draftId only writes one invoice; unknown and expired write nothing',async()=>{
 const pool=memoryDrafts();
 const invoices=[];
 let submits=0;
 const relayFactory=()=>({async submit(intent){
  submits++;
  assert.match(intent.requestId,/^grok-[0-9a-f]{32}$/);
  const invoice={invoiceNo:1,id:'ledger-1',total:intent.order.total};
  invoices.push(invoice);
  return {state:'COMMITTED',invoice,duplicate:false};
 }});
 const d=await createDraft(pool,()=>{throw new Error('draft must not read the ledger')},newOrder());
 let kicks=0;
 const first=await confirmDraft(pool,reader,relayFactory,{draftId:d.draftId},()=>{kicks++});
 assert.equal(first.state,'COMMITTED');assert.equal(first.invoiceNo,1);assert.equal(first.duplicate,false);assert.equal(kicks,1);
 const second=await confirmDraft(pool,reader,relayFactory,{draftId:d.draftId},()=>{kicks++});
 assert.equal(second.state,'COMMITTED');assert.equal(second.invoiceNo,1);assert.equal(second.duplicate,true);
 assert.equal(submits,1);assert.equal(invoices.length,1);assert.equal(kicks,1);
 assert.equal(pool.rows.get(d.draftId).status,'committed');

 submits=0;
 await assert.rejects(()=>confirmDraft(pool,reader,relayFactory,{draftId:'00000000-0000-4000-8000-000000000000'}),
  e=>e instanceof GrokOrderError&&e.code==='DRAFT_NOT_FOUND');
 assert.equal(submits,0);assert.equal(invoices.length,1);assert.equal(pool.rows.size,1);

 const expired=await createDraft(pool,()=>{throw new Error('draft must not read the ledger')},newOrder());
 pool.rows.get(expired.draftId).expires_at=new Date(Date.now()-60_000);
 await assert.rejects(()=>confirmDraft(pool,reader,relayFactory,{draftId:expired.draftId}),
  e=>e instanceof GrokOrderError&&e.code==='DRAFT_EXPIRED');
 assert.equal(submits,0);assert.equal(invoices.length,1);
 assert.equal(pool.rows.get(expired.draftId).status,'draft');
 assert.equal(pool.rows.get(expired.draftId).invoice_no,null);
});

test('owner-writes flag off rejects order tools before any write',async()=>{
 const pool=memoryDrafts();
 const env={GROK_OWNER_WRITES_ENABLED:'0'};
 const deps={env,reader(){throw new Error('reader')},relayFactory(){throw new Error('writer')}};
 for(const name of ['satori_order_draft','satori_order_confirm']){
  const res=await handleGrokRpc(pool,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:newOrder()}},deps);
  assert.equal(res.error.code,-32602);
 }
 assert.equal(pool.rows.size,0);
 const off=await handleGrokRpc(pool,{jsonrpc:'2.0',id:2,method:'initialize',params:{}},deps);
 assert.doesNotMatch(off.result.instructions,/mã duyệt|approvalCode/);
 const on=await handleGrokRpc(pool,{jsonrpc:'2.0',id:3,method:'initialize',params:{}},{env:{GROK_OWNER_WRITES_ENABLED:'1'}});
 assert.match(on.result.instructions,/ok/);
 assert.doesNotMatch(on.result.instructions,/mã duyệt|approvalCode/);
 assert.equal(pool.rows.size,0);
});

/** Calls satori_order_confirm through the real MCP dispatcher (owner writes ON). */
const rpcConfirm=(pool,deps,args)=>handleGrokRpc(pool,{jsonrpc:'2.0',id:9,method:'tools/call',
 params:{name:'satori_order_confirm',arguments:args}},{env:{GROK_OWNER_WRITES_ENABLED:'1'},...deps});
function countingRelay(){
 const state={submits:0,invoices:[]};
 state.relayFactory=()=>({async submit(intent){
  state.submits++;
  assert.equal(Object.hasOwn(intent,'approvalCode'),false,'approvalCode must never reach the ledger');
  const invoice={invoiceNo:state.invoices.length+1,id:'ledger-'+(state.invoices.length+1),total:intent.order.total};
  state.invoices.push(invoice);
  return {state:'COMMITTED',invoice,duplicate:false};
 }});
 return state;
}

test('confirm with legacy approvalCode (any value) gives exactly the same result as draftId only',async()=>{
 const outcomes=[];
 for(const extra of [{},{approvalCode:'1234'},{approvalCode:'0000'},{approvalCode:'sai-ma'},{approvalCode:''}]){
  const pool=memoryDrafts();
  const relay=countingRelay();
  let kicks=0;
  const d=await createDraft(pool,()=>{throw new Error('draft must not read the ledger')},newOrder());
  const res=await rpcConfirm(pool,{reader,relayFactory:relay.relayFactory,kick:()=>{kicks++}},{draftId:d.draftId,...extra});
  assert.equal(res.result.isError,undefined,JSON.stringify(res));
  assert.equal(res.result.structuredContent.state,'COMMITTED');
  assert.equal(relay.submits,1);assert.equal(kicks,1);
  const row=pool.rows.get(d.draftId);
  assert.equal(row.status,'committed');
  // Not stored anywhere on the draft row.
  assert.equal(JSON.stringify(row).includes('approvalCode'),false);
  outcomes.push({result:res.result,row:{status:row.status,invoice_no:row.invoice_no,ledger_id:row.ledger_id,
   last_note:row.last_note,code_hash:row.code_hash,order_payload:row.order_payload}});
 }
 for(const o of outcomes.slice(1))assert.deepEqual(o,outcomes[0]);
});

test('confirming twice with approvalCode still writes exactly one invoice',async()=>{
 const pool=memoryDrafts();
 const relay=countingRelay();
 const d=await createDraft(pool,()=>{throw new Error('draft must not read the ledger')},newOrder());
 const deps={reader,relayFactory:relay.relayFactory};
 const first=await rpcConfirm(pool,deps,{draftId:d.draftId,approvalCode:'1234'});
 const second=await rpcConfirm(pool,deps,{draftId:d.draftId,approvalCode:'9999'});
 assert.equal(first.result.structuredContent.state,'COMMITTED');
 assert.equal(first.result.structuredContent.duplicate,false);
 assert.equal(second.result.structuredContent.state,'COMMITTED');
 assert.equal(second.result.structuredContent.duplicate,true);
 assert.equal(second.result.structuredContent.invoiceNo,first.result.structuredContent.invoiceNo);
 assert.equal(relay.submits,1);assert.equal(relay.invoices.length,1);
});

test('unknown or expired draft with approvalCode fails and writes nothing',async()=>{
 const pool=memoryDrafts();
 const relay=countingRelay();
 const deps={reader,relayFactory:relay.relayFactory};
 const missing=await rpcConfirm(pool,deps,{draftId:'00000000-0000-4000-8000-000000000000',approvalCode:'1234'});
 assert.equal(missing.result.isError,true);
 assert.match(missing.result.content[0].text,/^DRAFT_NOT_FOUND:/);
 const expired=await createDraft(pool,()=>{throw new Error('draft must not read the ledger')},newOrder());
 pool.rows.get(expired.draftId).expires_at=new Date(Date.now()-60_000);
 const res=await rpcConfirm(pool,deps,{draftId:expired.draftId,approvalCode:'1234'});
 assert.equal(res.result.isError,true);
 assert.match(res.result.content[0].text,/^DRAFT_EXPIRED:/);
 assert.equal(relay.submits,0);assert.equal(relay.invoices.length,0);
 const row=pool.rows.get(expired.draftId);
 assert.equal(row.status,'draft');assert.equal(row.invoice_no,null);assert.equal(row.ledger_id,null);
 assert.equal(pool.rows.size,1);
});

test('owner-writes flag off still blocks confirm sent with approvalCode',async()=>{
 const pool=memoryDrafts();
 const d=await createDraft(pool,()=>{throw new Error('draft must not read the ledger')},newOrder());
 let touched=0;
 for(const env of [{},{GROK_OWNER_WRITES_ENABLED:'0'},{GROK_OWNER_WRITES_ENABLED:'true'}]){
  const deps={env,reader(){touched++;throw new Error('reader')},relayFactory(){touched++;throw new Error('writer')}};
  const res=await handleGrokRpc(pool,{jsonrpc:'2.0',id:1,method:'tools/call',
   params:{name:'satori_order_confirm',arguments:{draftId:d.draftId,approvalCode:'1234'}}},deps);
  assert.equal(res.error.code,-32602);
 }
 assert.equal(touched,0);
 assert.equal(pool.rows.get(d.draftId).status,'draft');
 assert.equal(pool.rows.get(d.draftId).invoice_no,null);
});
