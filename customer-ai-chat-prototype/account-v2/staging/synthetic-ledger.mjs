// Synthetic fixture ONLY. No real Drive, properties, credentials or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readMinhSatori} from '../../satori-readonly.mjs';
import {createOwnerWriteRelay} from '../grok-owner-writes.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const PROD=path.resolve(HERE,'../../../apps-script/production-snapshot-20261115');
const NOW=Date.parse('2026-11-16T03:00:00Z');
const ENDPOINT='https://script.google.com/macros/s/'+'P'.repeat(40)+'/exec';
const SECRET={reader:'fake-reader-secret-0123456789abcdefghij',writer:'fake-writer-secret-0123456789abcdefghij'};
const WRITER_SCOPES=['orders:read','orders:write','orders:delete','orders:update','payments:write'];
const ENV={GROK_OWNER_WRITES_ENABLED:'1',SATORI_GROK_MCP_ENABLED:'1',SATORI_GROK_MCP_TOKEN:'t'.repeat(48)};
const WRITER_ENV={SATORI_V2_CANONICAL_WRITES_ENABLED:'1',SATORI_V2_CANONICAL_WRITE_ENDPOINT:ENDPOINT,
 SATORI_V2_CANONICAL_WRITE_KEY_ID:'v2writer',SATORI_V2_CANONICAL_WRITE_SECRET:SECRET.writer,SATORI_READ_KEY_ID:'v2reader'};

const rowsFixture=()=>[
 {id:'L501',invoiceNo:501,date:'14/11/2026',timestamp:NOW-86400000,name:'Khách Sửa Giả',phone:'0900000501',location:'01 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả 500ml',qty:2,unitPrice:150000}],product:'Nước Giả 500ml x2',qty:2,total:300000,goodsTotal:300000,
  shippingAmount:0,vatAmount:0,status:'Chưa thanh toán'},
 {id:'L502',invoiceNo:502,date:'14/11/2026',name:'Khách Đã Trả Giả',phone:'0900000502',location:'02 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:90000}],total:90000,status:'Đã thanh toán',customerPaidAt:'2026-11-14T01:00:00.000Z'},
 {id:'L503',invoiceNo:503,date:'15/11/2026',name:'Khách Thanh Toán Giả',phone:'0900000503',location:'03 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:120000}],total:120000,status:'Chưa thanh toán'},
 {id:'L504',invoiceNo:504,date:'15/11/2026',name:'CTV Nội Bộ Giả',phone:'0900000504',location:'04 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:50000}],total:50000,status:'Chưa thanh toán',pairGroupId:'P1',pairRole:'collaborator',pairInvoiceNo:505},
 {id:'L506',invoiceNo:506,date:'15/11/2026',name:'Khách Có VAT Giả',phone:'0900000506',location:'06 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:100000}],total:108000,goodsTotal:100000,vatAmount:8000,vat:'yes',status:'Chưa thanh toán'},
 {id:'L507',invoiceNo:507,date:'15/11/2026',name:'Khách Đã Hủy Giả',phone:'0900000507',location:'07 Đường Giả, Quận Giả',
  items:[{product:'Nước Giả',qty:1,unitPrice:70000}],total:70000,status:'Đã hủy'}];

/** Production BotApi in a VM. Returns the ledger plus Grok's real reader and writer relay wired to it. */
export function production({writerScopes=WRITER_SCOPES,writerRole='owner'}={}){
 const src=f=>fs.readFileSync(path.join(PROD,f),'utf8');
 let raw=JSON.stringify({revision:20,updatedAt:'2026-11-16T00:00:00Z',values:{
  satori_orders_v15:JSON.stringify(rowsFixture()),satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]',
  satori_catalogue_v15:JSON.stringify([{code:'TP-99999',name:'Nước Giả',unit:'Thùng',listPrice:100000,unitPrice:100000}])}});
 let writes=0;const sent=[];
 const clients={v2reader:{secret:SECRET.reader,scopes:['orders:read','debt:read','catalogue:read'],role:'owner'},
  v2writer:{secret:SECRET.writer,scopes:writerScopes,...(writerRole?{role:writerRole}:{})}};
 const props={STATE_FILE_ID:'fake-state',SATORI_BOT_CLIENTS_JSON:JSON.stringify(clients)};
 const cache=new Map();
 const file={getBlob:()=>({getDataAsString:()=>raw}),
  makeCopy:()=>{const copy=raw;return {getId:()=>'b',getBlob:()=>({getDataAsString:()=>copy})}},setContent:v=>{raw=v;writes++}};
 const out=s=>{const o={getContent:()=>s,setMimeType:()=>o,toString:()=>s};return o};
 const ctx={console,readState_:()=>JSON.parse(raw),
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null})},
  DriveApp:{getFileById:()=>file},
  Utilities:{Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},
   computeHmacSha256Signature:(m,k)=>[...crypto.createHmac('sha256',k).update(m,'utf8').digest()],
   computeDigest:(a,m)=>[...crypto.createHash('sha256').update(String(m),'utf8').digest()],
   formatDate:()=>'16/11/2026',getUuid:()=>crypto.randomUUID()},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:out},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})}};
 vm.createContext(ctx);
 vm.runInContext(src('AccountingCore.gs'),ctx);
 vm.runInContext(src('BotApi.gs'),ctx);
 const fetcher=async(url,opts)=>{
  assert.equal(url,ENDPOINT);const body=JSON.parse(opts.body);sent.push({keyId:body.keyId,action:body.action});
  return {ok:true,text:async()=>String(ctx.doPost({postData:{contents:opts.body}}))};
 };
 const relay=createOwnerWriteRelay({env:WRITER_ENV,fetcher});
 const reader=async(action,payload)=>{
  const saved={...process.env},savedFetch=globalThis.fetch;
  Object.assign(process.env,{SATORI_READ_ENDPOINT:ENDPOINT,SATORI_READ_KEY_ID:'v2reader',SATORI_READ_HMAC_SECRET:SECRET.reader});
  globalThis.fetch=fetcher;
  try{return await readMinhSatori(action,payload)}
  finally{globalThis.fetch=savedFetch;for(const k of ['SATORI_READ_ENDPOINT','SATORI_READ_KEY_ID','SATORI_READ_HMAC_SECRET'])
   if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
 };
 const state=()=>JSON.parse(raw);
 return {reader,relay,fetcher,writerEnv:WRITER_ENV,rf:()=>relay,sent,get writes(){return writes},state,
  row:no=>JSON.parse(state().values.satori_orders_v15).find(o=>o.invoiceNo===no),
  editLog:()=>JSON.parse(state().values.satori_order_edit_audit_v1||'[]')};
}

