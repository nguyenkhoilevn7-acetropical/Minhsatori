/**
 * Owner-reviewed, deliberately UNWIRED Account V2 -> canonical Bot API relay.
 * Do not add a public route or enable real writes until a durable V2 request
 * journal, fake-Apps-Script E2E and owner approval are in place.
 *
 * BotApi.gs PR #230 adds orders.findByRequestId for lost-response recovery.
 * Every request is signed server-side. No unsigned browser/Gemini write path.
 */
import crypto from 'node:crypto';

const FAIL=code=>{const e=new Error(code);e.code=code;throw e};
const need=(v,code)=>{if(!v)FAIL(code)};
const num=v=>Number.isSafeInteger(v)&&v>=0&&v<=100_000_000_000;
const rid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(v);
const money=v=>Number.isSafeInteger(v)&&v>=0&&v<=1_000_000_000;
const endpointOk=v=>typeof v==='string'&&
 /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(v);
const sameIdentity=(a,b)=>{
 if(!a||!b||String(a.name||'').trim()!==String(b.name||'').trim()||
  String(a.location||'').trim()!==String(b.location||'').trim()||
  String(a.phone||'').replace(/\D/g,'')!==String(b.phone||'').replace(/\D/g,'')||
  Number(a.total)!==Number(b.total))return false;
 if(!Array.isArray(a.items)||!Array.isArray(b.items)||a.items.length!==b.items.length)return false;
 return a.items.every((x,i)=>{
  const y=b.items[i];
  return x.code===y?.code&&x.qty===y?.qty&&x.unitPrice===y?.unitPrice&&
   x.listPrice===y?.listPrice&&x.product===y?.product&&x.unit===y?.unit;
 });
};
/**
 * Consumes ONLY a server-repriced, current V2 quote; the caller must execute
 * assertCurrentQuote under the same transaction lock as it persists the request.
 * A Gemini model never supplies any field here.
 */
export function prepareLedgerIntent({requestId,expectedRevision,quote,customerRef=null}){
 need(rid(requestId),'LEDGER_REQUEST_ID_INVALID');
 need(Number.isSafeInteger(expectedRevision)&&expectedRevision>=1,'LEDGER_REVISION_REQUIRED');
 need(quote?.currency==='VND'&&quote.invoiceMode==='single'&&
  typeof quote.profileId==='string'&&typeof quote.addressId==='string'&&
  quote.delivery?.addressId===quote.addressId,'LEDGER_QUOTE_NOT_VERIFIED');
 need(Array.isArray(quote.items)&&quote.items.length>0&&quote.items.length<=40,
  'LEDGER_ITEMS_INVALID');
 const items=quote.items.map(x=>{
  need(x&&/^TP-[0-9]{5}$/.test(x.code)&&typeof x.name==='string'&&
   x.name.trim().length>=2&&x.name.length<=180&&typeof x.unit==='string'&&
   x.unit.trim().length>0&&x.unit.length<=40&&
   Number.isSafeInteger(x.qty)&&x.qty>=1&&x.qty<=500&&
   money(x.unitPrice)&&money(x.listPrice)&&x.unitPrice<=x.listPrice&&
   num(x.lineTotal)&&x.lineTotal===x.qty*x.unitPrice,'LEDGER_ITEM_PRICE_INVALID');
  return {code:x.code,product:x.name,unit:x.unit,qty:x.qty,
   unitPrice:x.unitPrice,listPrice:x.listPrice};
 });
 const goods=items.reduce((n,x)=>n+x.qty*x.unitPrice,0);
 need(num(goods)&&num(quote.goodsVnd)&&goods===quote.goodsVnd&&
  num(quote.shippingVnd)&&num(quote.vatVnd)&&num(quote.totalVnd)&&
  goods+quote.shippingVnd+quote.vatVnd===quote.totalVnd,'LEDGER_TOTAL_CHANGED');
 const d=quote.delivery;
 need(typeof d.recipientName==='string'&&d.recipientName.trim().length>=2&&
  typeof d.recipientPhone==='string'&&/^\+?[0-9]{9,15}$/.test(d.recipientPhone)&&
  typeof d.address==='string'&&d.address.trim().length>=5&&d.address.length<=400,
  'LEDGER_DELIVERY_INVALID');
 const note=quote.deliveryRequest?.deliveryNote??'';
 need(typeof note==='string'&&note.length<=300,'LEDGER_DELIVERY_NOTE_INVALID');
 const order={name:d.recipientName.trim(),phone:d.recipientPhone,
  location:d.address.trim(),items,shippingAmount:quote.shippingVnd,
  vatAmount:quote.vatVnd,total:quote.totalVnd,deliveryNote:note};
 const payload={requestId,expectedRevision,order};
 if(customerRef!=null){
  need(customerRef&&
   (typeof customerRef.id==='string'||Number.isSafeInteger(customerRef.id))&&
   Number.isSafeInteger(customerRef.invoiceNo)&&customerRef.invoiceNo>0,
   'LEDGER_CUSTOMER_REF_INVALID');
  payload.customerRef={id:customerRef.id,invoiceNo:customerRef.invoiceNo};
 }else payload.confirmedNewCustomer=true; // explicit V2 verified account, not legacy name guess
 return Object.freeze(payload);
}
export function assertSameLedgerInvoice(intent,invoice){
 need(invoice&&Number.isSafeInteger(Number(invoice.invoiceNo))&&Number(invoice.invoiceNo)>0&&
  (typeof invoice.id==='string'||Number.isSafeInteger(invoice.id))&&
  sameIdentity(intent?.order,invoice),'LEDGER_READBACK_MISMATCH');
 return {id:invoice.id,invoiceNo:Number(invoice.invoiceNo),
  total:Number(invoice.total)};
}
export function ledgerRelayConfig(env){
 need(env?.SATORI_V2_CANONICAL_WRITES_ENABLED==='1','LEDGER_RELAY_DISABLED');
 const endpoint=String(env.SATORI_V2_CANONICAL_WRITE_ENDPOINT||'');
 const keyId=String(env.SATORI_V2_CANONICAL_WRITE_KEY_ID||'');
 const secret=String(env.SATORI_V2_CANONICAL_WRITE_SECRET||'');
 need(endpointOk(endpoint)&&/^[A-Za-z0-9_-]{3,64}$/.test(keyId)&&
  secret.length>=32,'LEDGER_RELAY_NOT_CONFIGURED');
 need(keyId!==String(env.SATORI_READ_KEY_ID||'')&&
  keyId!==String(env.SATORI_CTV_PAIR_READ_KEY_ID||''),
  'LEDGER_WRITER_MUST_BE_SEPARATE');
 return {endpoint,keyId,secret};
}
export function createV2CanonicalRelay({env={},fetcher,now=()=>Date.now(),
 generateNonce=()=>crypto.randomBytes(18).toString('hex')}={}){
 need(typeof fetcher==='function','LEDGER_FETCH_REQUIRED');
 async function send(action,payload){
  need(['system.status','orders.findByRequestId','orders.create'].includes(action),
   'LEDGER_ACTION_DENIED');
  const {endpoint,keyId,secret}=ledgerRelayConfig(env);
  const timestamp=now(),nonce=generateNonce();
  need(Number.isSafeInteger(timestamp)&&rid(nonce),'LEDGER_SIGNING_UNAVAILABLE');
  const message=[keyId,timestamp,nonce,action,JSON.stringify(payload)].join('\n');
  const signature=crypto.createHmac('sha256',secret).update(message,'utf8').digest('hex');
  let response,raw,body;
  try{
   response=await fetcher(endpoint,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({keyId,timestamp,nonce,action,payload,signature})});
   if(!response?.ok)FAIL('LEDGER_NETWORK_OR_TIMEOUT');
   raw=await response.text();
   need(typeof raw==='string'&&raw.length<200_000,'LEDGER_RESPONSE_INVALID');
   body=JSON.parse(raw);
  }catch{FAIL('LEDGER_NETWORK_OR_TIMEOUT')}
  if(body?.ok!==true||body.action!==action){
   const code=String(body?.error?.code||'');
   if(code==='REVISION_CONFLICT')FAIL('LEDGER_REVISION_CONFLICT');
   if(code==='REQUEST_ID_CONFLICT'||code==='REUSED_REQUEST_ID')
    FAIL('LEDGER_REQUEST_ID_CONFLICT');
   FAIL('LEDGER_UPSTREAM_REJECTED');
  }
  need(Number.isSafeInteger(body.revision)&&body.revision>=1,'LEDGER_RESPONSE_INVALID');
  return body;
 }
 async function findIntent(intent){
  const found=await send('orders.findByRequestId',{requestId:intent.requestId});
  const state=found?.data?.state;
  if(state==='NOT_FOUND'&&found.data.found===false)return null;
  if(state==='DELETED')FAIL('LEDGER_INVOICE_ALREADY_DELETED');
  need(state==='COMMITTED'&&found.data.found===true,'LEDGER_READBACK_INVALID');
  return assertSameLedgerInvoice(intent,found.data.order);
 }
 /**
  * Never issue a second orders.create automatically after a failed request.
  * The returned UNCERTAIN state MUST remain in durable V2 pending journal.
  */
 async function submit(intent){
  need(rid(intent?.requestId)&&Number.isSafeInteger(intent?.expectedRevision)&&
   intent.expectedRevision>=1&&intent.order,'LEDGER_INTENT_INVALID');
  // Reused requestId first verifies an existing canonical invoice, no write.
  try{
   const existing=await findIntent(intent);
   if(existing)return {state:'COMMITTED',duplicate:true,invoice:existing};
  }catch(e){
   if(e.code==='LEDGER_NETWORK_OR_TIMEOUT')return {state:'UNCERTAIN',reason:'READBACK_UNAVAILABLE'};
   throw e;
  }
  // Expected revision protects against a stale V2 pricing/identity baseline.
  let status;
  try{status=await send('system.status',{});}
  catch{return {state:'UNCERTAIN',reason:'LEDGER_STATUS_UNAVAILABLE'}}
  if(status.revision!==intent.expectedRevision)
   return {state:'REJECTED',reason:'LEDGER_REVISION_CONFLICT'};
  let created;
  try{created=await send('orders.create',intent);}
  catch(e){
   // Even on a rejected/timeout response the server may already have written.
   // The only safe recovery is a read by the SAME immutable requestId.
   if(e.code==='LEDGER_REQUEST_ID_CONFLICT')throw e;
   created=null;
  }
  try{
   const exact=await findIntent(intent);
   if(!exact)return {state:'UNCERTAIN',reason:'NO_CANONICAL_READBACK'};
   if(created?.data?.order){
    need(String(created.data.order.id)===String(exact.id)&&
     Number(created.data.order.invoiceNo)===exact.invoiceNo,'LEDGER_TWO_PROOFS_DISAGREE');
   }
   return {state:'COMMITTED',duplicate:created?.data?.duplicate===true,
    invoice:exact};
  }catch(e){
   if(['LEDGER_NETWORK_OR_TIMEOUT','LEDGER_READBACK_INVALID'].includes(e.code))
    return {state:'UNCERTAIN',reason:'READBACK_UNAVAILABLE'};
   throw e;
  }
 }
 return Object.freeze({submit,findIntent});
}
