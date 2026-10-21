/** One pending TEST basket per customer link. No customer PII, prices or bearer tokens in responses. */
import {productFor,resolveProduct,fold} from './catalogue.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
export const MAX_LINES=6, MAX_UNITS=500;
export function makeDraftStore(options={}){
 // Only a SHA-256 lookup digest of each bearer link is persisted — never its raw token.
 // This keeps browser/WebView sessions on the same server-authoritative revisioned basket.
 const states=new Map();
 const volatileDemoKeys=new Set(); // Anonymous test baskets never enter durable backup.
 const filePath=options.filePath||null;
 const onChange=typeof options.onChange==='function'?options.onChange:()=>{};
 const expiresMs=24*3600_000;
 const keyOf=token=>crypto.createHash('sha256').update('minh-satori-sandbox-draft-v1:'+String(token)).digest('hex');
 function verifiedRow(item){
  if(!item||typeof item!=='object'||!/^([a-f0-9]{64})$/.test(item.key)||
      !Number.isSafeInteger(item.revision)||item.revision<1||
      !Number.isSafeInteger(item.updatedAt)||item.updatedAt<1||item.updatedAt>Date.now()+60_000||
      !Array.isArray(item.items)||item.items.length>MAX_LINES)throw Error('INVALID_DRAFT_CACHE');
  const lines=new Map();
  for(const row of item.items){
   if(!row||typeof row!=='object'||!productFor(row.code)||
      row.code!==productFor(row.code).code||!Number.isSafeInteger(row.qty)||
      row.qty<1||row.qty>MAX_UNITS||lines.has(row.code))throw Error('INVALID_DRAFT_CACHE');
   lines.set(row.code,row.qty);
  }
  if([...lines.values()].reduce((sum,v)=>sum+v,0)>MAX_UNITS)throw Error('INVALID_DRAFT_CACHE');
  const deliveryNote=item.deliveryNote??'';
  if(typeof deliveryNote!=='string'||deliveryNote.length>300||
     /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(deliveryNote))throw Error('INVALID_DRAFT_CACHE');
  const requestedDeliveryAt=item.requestedDeliveryAt??null;
  if(requestedDeliveryAt!==null&&(typeof requestedDeliveryAt!=='string'||
     !Number.isFinite(Date.parse(requestedDeliveryAt))))throw Error('INVALID_DRAFT_CACHE');
  return {key:item.key,revision:item.revision,updatedAt:item.updatedAt,lines,deliveryNote,requestedDeliveryAt};
 }
 function activeEntries(){
  const cutoff=Date.now()-expiresMs;
  return [...states].filter(([key,v])=>v.updatedAt>=cutoff&&!volatileDemoKeys.has(key));
 }
 function snapshot(){
  return activeEntries().map(([key,s])=>({
   key,revision:s.revision,updatedAt:s.updatedAt,
   items:[...s.lines].map(([code,qty])=>({code,qty})),
   ...(s.deliveryNote?{deliveryNote:s.deliveryNote}:{}),
   ...(s.requestedDeliveryAt?{requestedDeliveryAt:s.requestedDeliveryAt}:{})
  })).sort((a,b)=>a.key.localeCompare(b.key));
 }
 function persist(){
  if(!filePath)return;
  const temp=filePath+'.'+crypto.randomUUID()+'.tmp';
  try{
   fs.writeFileSync(temp,JSON.stringify({format:'minh-satori-sandbox-draft-cache-v1',drafts:snapshot()}),{mode:0o600,flag:'wx'});
   fs.renameSync(temp,filePath);
  }catch(e){try{fs.unlinkSync(temp)}catch{}throw e}
 }
 function load(){
  if(!filePath||!fs.existsSync(filePath))return;
  const data=JSON.parse(fs.readFileSync(filePath,'utf8'));
  if(data?.format!=='minh-satori-sandbox-draft-cache-v1'||!Array.isArray(data.drafts)||
      data.drafts.length>250)throw Error('INVALID_DRAFT_CACHE');
  for(const item of data.drafts){
   const row=verifiedRow(item);
   if([keyOf('demo-a'),keyOf('demo-b')].includes(row.key))continue;
   if(states.has(row.key))throw Error('INVALID_DRAFT_CACHE');
   if(Date.now()-row.updatedAt<expiresMs)states.set(row.key,{
    revision:row.revision,updatedAt:row.updatedAt,lines:row.lines,
    deliveryNote:row.deliveryNote,requestedDeliveryAt:row.requestedDeliveryAt
   });
  }
 }
 load(); // Fail closed if local data is damaged. Never silently discard outstanding baskets.
 function get(token){
  const key=keyOf(token),s=states.get(key);
  if(s&&Date.now()-s.updatedAt<expiresMs)return s;
  return {revision:0,lines:new Map(),updatedAt:Date.now(),deliveryNote:'',requestedDeliveryAt:null};
 }
 function read(token){
  const s=get(token);
  return {revision:s.revision,items:[...s.lines].map(([code,qty])=>{
   const p=productFor(code);return {code,qty,name:p.name,unit:p.unit};
  }),...(s.deliveryNote?{deliveryNote:s.deliveryNote}:{}),
  ...(s.requestedDeliveryAt?{requestedDeliveryAt:s.requestedDeliveryAt}:{})};
 }
 function mutate(token,changes,expectedRevision,delivery=null){
  const key=keyOf(token),s=get(token);
  if(typeof token==='string'&&/^demo-[ab](?:~[a-f0-9]{32})?$/.test(token))volatileDemoKeys.add(key);
  if(!Number.isSafeInteger(expectedRevision)||s.revision!==expectedRevision)throw Error('DRAFT_CONFLICT');
  if(!Array.isArray(changes)||changes.length<1||changes.length>MAX_LINES)throw Error('INVALID_CART');
  const next=new Map(s.lines);
  let note=s.deliveryNote||'',when=s.requestedDeliveryAt||null;
  for(const change of changes){
   if(change.action==='note'){
    if(typeof change.note!=='string'||change.note.length>300)throw Error('INVALID_NOTE');
    note=change.note;when=change.requestedDeliveryAt??null;continue;
   }
   if(change.action==='clear'){next.clear();continue}
   const p=productFor(change.code);
   if(!p)throw Error('INVALID_CART');
   const code=p.code,old=next.get(code)||0;
   if(change.action==='remove'){next.delete(code);continue}
   if(!Number.isSafeInteger(change.qty)||change.qty<1||change.qty>MAX_UNITS)throw Error('INVALID_CART');
   const qty=change.action==='add'?old+change.qty:
     change.action==='set'?change.qty:
     change.action==='subtract'?old-change.qty:NaN;
   if(!Number.isSafeInteger(qty)||qty<0||qty>MAX_UNITS)throw Error('INVALID_CART');
   if(qty===0)next.delete(code);else next.set(code,qty);
  }
  if(delivery?.deliveryNote){
   if(typeof delivery.deliveryNote!=='string'||delivery.deliveryNote.length>300)throw Error('INVALID_NOTE');
   note=delivery.deliveryNote;when=delivery.requestedDeliveryAt??null;
  }
  if(changes.some(x=>x.action==='clear')){note='';when=null}
  if(next.size>MAX_LINES||[...next.values()].reduce((n,v)=>n+v,0)>MAX_UNITS)throw Error('CART_LIMIT');
  const old=states.get(key);
  states.set(key,{revision:s.revision+1,lines:next,updatedAt:Date.now(),deliveryNote:note,requestedDeliveryAt:when});
  try{persist()}catch(e){if(old)states.set(key,old);else states.delete(key);throw e}
  onChange(); // schedules encrypted backup; cannot cause an extra invoice
  return read(token);
 }
 function restore(rows){
  if(activeEntries().length)throw Error('SANDBOX_DRAFT_NOT_EMPTY');
  if(!Array.isArray(rows)||rows.length>250)throw Error('INVALID_DRAFT_CACHE');
  const restoreStates=new Map();
  for(const item of rows){
   const row=verifiedRow(item);
   // Old shared demo link baskets are not customer orders. Never resurrect them.
   if([keyOf('demo-a'),keyOf('demo-b')].includes(row.key))continue;
   if(restoreStates.has(row.key))throw Error('INVALID_DRAFT_CACHE');
   if(Date.now()-row.updatedAt<expiresMs)restoreStates.set(row.key,{
    revision:row.revision,updatedAt:row.updatedAt,lines:row.lines,
    deliveryNote:row.deliveryNote,requestedDeliveryAt:row.requestedDeliveryAt});
  }
  const old=new Map(states);
  states.clear();
  for(const [k,v] of restoreStates)states.set(k,v);
  try{persist()}catch(e){states.clear();for(const [k,v] of old)states.set(k,v);throw e}
  onChange();
 }
 return {read,mutate,snapshot,restore};
}
export function contextualDraftEdit(message,profile,draft){
 const s=fold(message);
 // Only treat explicit changes as edits; a normal "cho 5 thùng" remains a new basket addition.
 const verb=/^(?:(?:cho|lay)\s+)?(them|cong them|bo sung|bot|giam|tru|bo|xoa|loai bo|doi|sua|chinh|cap nhat|cho con|con lai)\b/.exec(s);
 const extra=/^(?:cho |lay )?(\d{1,3})\s*(?:thung|binh|loc|chai)\s+nua\b/.exec(s);
 if(!verb&&!extra)return null;
 const v=verb?.[1]||'them', remove=/^(bo|xoa|loai bo)$/.test(v),
  subtract=/^(bot|giam|tru)$/.test(v), set=/^(doi|sua|chinh|cap nhat|cho con|con lai)$/.test(v);
 const selection=resolveProduct(message,profile);
 if(selection.ambiguous)return {clarification:'Bạn vui lòng nói rõ mặt hàng cần sửa trong giỏ.'};
 const chosen=selection.sku?productFor(selection.sku)?.code:null;
 const code=chosen||(draft.items.length===1?draft.items[0].code:null);
 if(!code)return {clarification:'Giỏ có nhiều mặt hàng. Bạn vui lòng nói rõ tên hoặc dung tích sản phẩm cần sửa.'};
 if(remove)return {changes:[{action:'remove',code}]};
 const time= s.match(/\b(?:thanh|con|lai)\s+(\d{1,3})(?:\s*(?:thung|binh|loc|chai))?\b/);
 // "thêm 3 ổi hồng" must change the current draft without an explicit "thùng".
 // Only explicitly named JUICE cartons may omit the carton unit.
 const implicitJuice=productFor(code)?.brand==='JUICE' &&
  !/\b(lon|chai|ly|binh|loc)\b/.test(s) ?
   s.match(/\b(\d{1,3})\s+(?:(?:nuoc ep|ep)\s+)?(?:oi hong|mang cau|man cau|me)\b/) : null;
 const amount=extra?Number(extra[1]):time?Number(time[1]):
  Number((s.match(/\b(\d{1,3})\s*(?:thung|binh|loc|chai|don vi)(?=\s|$)/)||[])[1]||implicitJuice?.[1]||0);
 if(!Number.isSafeInteger(amount)||amount<1||amount>MAX_UNITS)
  return {clarification:'Bạn muốn sửa bao nhiêu đơn vị? Ví dụ: thêm 2 thùng Satori 500ml.'};
 return {changes:[{action:set?'set':subtract?'subtract':'add',code,qty:amount}]};
}
