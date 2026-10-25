/**
 * OWNER-ONLY real invoice pilot for Gemini text orders.
 * Real data/prices are read from Apps Script, not Gemini output or public chat.
 * NO write until independent owner admin bearer, explicitly scoped HMAC writer,
 * live pilot flag, and human-reviewed quote confirmation all succeed.
 *
 * This intentionally does not expose a customer endpoint. Never use the
 * sandbox fake profiles to decide customer/discount/price.
 */
import crypto from 'node:crypto';
import {contactPhone} from './contact-phone.mjs';
import {parseOrder,identityChange} from './free-parser.mjs';
import {parseMultiOrder} from './multi-order.mjs';
import {splitOrderAndNote} from './order-with-notes.mjs';
import {productFor} from './catalogue.mjs';

const fail=code=>{const e=new Error(code);e.code=code;throw e};
const okId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{3,64}$/.test(v);
const urlRx=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,180}\/exec$/;
const pct=(v,max=100)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
const clean=v=>String(v??'').trim();
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const secretKey=secret=>crypto.createHash('sha256').update('MINH-SATORI-OWNER-QUOTE-V1\0'+secret).digest();
function policy(env){
 if(env.GEMINI_OWNER_ONLY_REAL_PILOT!=='1'||env.GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY==='1')
  fail('OWNER_REAL_PILOT_DISABLED');
 // Reuse an EXISTING server-only Bot writer if provisioned, rather than making
 // the owner retype the same protected HMAC key into another environment field.
 // Never use the separate read-only client as a writer.
 const endpoint=clean(env.SATORI_OWNER_CHECKOUT_ENDPOINT||env.SATORI_READ_ENDPOINT||env.SATORI_BOT_API_URL||env.SATORI_CTV_PAIR_ENDPOINT);
 const keyId=clean(env.SATORI_OWNER_CHECKOUT_KEY_ID||env.SATORI_BOT_KEY_ID);
 const secret=String(env.SATORI_OWNER_CHECKOUT_SECRET||env.SATORI_BOT_SECRET||'');
 const adminSecret=String(env.CUSTOMER_LINKS_ADMIN_TOKEN||'');
 if(!urlRx.test(endpoint)||!okId(keyId)||secret.length<32||adminSecret.length<32)
  fail('OWNER_REAL_HMAC_NOT_CONFIGURED');
 if(keyId===clean(env.SATORI_READ_KEY_ID)||keyId===clean(env.SATORI_CTV_PAIR_READ_KEY_ID))
  fail('OWNER_WRITER_MUST_BE_SEPARATE');
 return {endpoint,keyId,secret,adminSecret};
}
export function createOwnerRealInvoice({
 env=process.env,fetcher=fetch,now=Date.now,newId=()=>crypto.randomBytes(18).toString('hex')
}={}){
 const intents=new Map();
 function readiness(){
  try{policy(env);return {ownerPilotWired:true,enabled:true,realWritesRequireConfirmation:true,
   customerAccessEnabled:false};}
  catch(e){return {ownerPilotWired:true,enabled:false,reason:e.code||'OWNER_DISABLED',
   realWritesRequireConfirmation:true,customerAccessEnabled:false};}
 }
 async function bot(action,payload={}){
  const {endpoint,keyId,secret}=policy(env),timestamp=now(),nonce=crypto.randomBytes(18).toString('hex');
  const signature=crypto.createHmac('sha256',secret).update([
   keyId,timestamp,nonce,action,JSON.stringify(payload)].join('\n')).digest('hex');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetcher(endpoint,{method:'POST',
    headers:{'content-type':'application/json'},redirect:'follow',
    signal:controller.signal,
    body:JSON.stringify({keyId,timestamp,nonce,action,payload,signature})});
   if(!response?.ok)fail('OWNER_BOT_UNCERTAIN');
   const body=await response.text();
   if(body.length>150000)fail('OWNER_BOT_RESPONSE_INVALID');
   const parsed=JSON.parse(body);
   if(parsed?.ok!==true||parsed.action!==action){
    const code=String(parsed?.error?.code||'');
    if(['FORBIDDEN','AUTH_FAILED','REVISION_CONFLICT','PROFILE_MISMATCH',
      'CATALOGUE_NOT_PERSISTED','REQUEST_ID_CONFLICT','REUSED_REQUEST_ID','INVALID_REQUEST',
      'LINK_REGISTRY_INVALID','LINK_REGISTRY_FULL','LINK_REGISTRY_CONFLICT',
      'LINK_REGISTRY_READ_UNVERIFIED','LINK_REGISTRY_WRITE_UNVERIFIED',
      'LINK_REGISTRY_REVISION_INVALID','COMMIT_UNVERIFIED','BACKUP_FAILED',
      'CONFIG_MISSING'].includes(code))
      fail(code);
    fail('OWNER_BOT_UPSTREAM_REJECTED');
   }
   if(!Number.isSafeInteger(parsed.revision)||parsed.revision<1)fail('OWNER_BOT_RESPONSE_INVALID');
   return parsed;
  }catch(e){if(e?.code)throw e;fail('OWNER_BOT_UNCERTAIN')}
  finally{clearTimeout(timer)}
 }
 async function probeWriter(){
  // Scope-only proof with zero writes and zero PII returned or logged.
  const status=await bot('system.status',{});
  const catalogue=await bot('catalogue.list',{});
  const orders=await bot('orders.list',{query:'GEMINI_OWNER_PROBE_NO_MATCH_20261023',limit:1});
  if(!Number.isSafeInteger(status.data?.orders)||
     !Array.isArray(catalogue.data?.products)||catalogue.data.products.length<1||
     catalogue.data?.source!=='drive-ledger:satori_catalogue_v15'||
     !Array.isArray(orders.data?.orders))fail('OWNER_WRITER_READ_SCHEMA_INVALID');
  return Object.freeze({verified:true,revision:status.revision,
   invoiceCount:status.data.orders,catalogueProducts:catalogue.data.products.length,
   permissions:'orders_read_catalogue_read'});
 }
 async function source(invoiceNo,customerId=null,knownCatalogue=null,{allowMissingPhone=false}={}){
  // Missing contact is allowed ONLY for an exact owner-reviewed legacy invoice.
  // This read-only exception cannot authorise an order by itself.
  if(allowMissingPhone&&customerId==null)fail('OWNER_CUSTOMER_REFERENCE_REQUIRED');
  if(!Number.isSafeInteger(invoiceNo)||invoiceNo<1)fail('OWNER_CUSTOMER_REFERENCE_REQUIRED');
  const [cat,old]=await Promise.all([
   knownCatalogue||bot('catalogue.list',{}),
   bot('orders.list',{query:String(invoiceNo),limit:100})
  ]);
  if(cat.revision!==old.revision||cat.data?.revision!==cat.revision||
     cat.data?.source!=='drive-ledger:satori_catalogue_v15'||
     !Array.isArray(cat.data?.products)||cat.data.products.length<1||
     !Array.isArray(old.data?.orders))fail('OWNER_LEDGER_SOURCE_MISMATCH');
  // Duplicate historical invoice IDs are valid source evidence ONLY when
  // exactly one record has a complete name, phone and delivery address.
  // Never choose arbitrarily between two complete source records.
  const matched=old.data.orders.filter(o=>Number(o.invoiceNo)===invoiceNo&&
    (customerId==null||String(o.id)===String(customerId))&&
    o.pairRole!=='collaborator'&&o.id!=null&&
    clean(o.name).length>=2&&(!!contactPhone(o.phone||o.customerPhone)||allowMissingPhone)&&
    clean(o.location).length>=5);
  if(matched.length!==1||Number(old.data.totalMatches)>100)fail('OWNER_CUSTOMER_REFERENCE_AMBIGUOUS');
  const customer=matched[0];
  const verifiedPhone=contactPhone(customer.phone||customer.customerPhone);
  if(customer.id==null||clean(customer.name).length<2||
    (!verifiedPhone&&!allowMissingPhone)||
    clean(customer.location).length<5)fail('OWNER_CUSTOMER_REFERENCE_INVALID');
  const ids=new Map();
  for(const p of cat.data.products){
   if(!p||!/^TP-[0-9]{5}$/.test(p.code)||ids.has(p.code)||
       !Number.isSafeInteger(p.listPrice)||p.listPrice<0||
       clean(p.name).length<2||!clean(p.unit))fail('OWNER_CATALOGUE_INVALID');
   ids.set(p.code,p);
  }
  // Canonical contact digits are equivalent to a labelled historic phone field.
  // The Bot API matches the digits, not the recipient annotation, on checkout.
  return {revision:cat.revision,customer:{...customer,phone:verifiedPhone},products:ids};
 }
 // A 17-location agency used to make 34 sequential signed Drive calls.
 // Share one immutable catalogue revision and bound the invoice reads to 3
 // concurrent requests; every historical record is still checked individually.
 async function sourceBatch(refs){
  if(!Array.isArray(refs)||refs.length<1||refs.length>20||
     refs.some(x=>!x||!Number.isSafeInteger(x.invoiceNo)||x.invoiceNo<1||
      x.id==null))fail('OWNER_CUSTOMER_REFERENCE_REQUIRED');
  const catalogue=await bot('catalogue.list',{});
  const found=[];
  for(let i=0;i<refs.length;i+=3){
   const chunk=await Promise.all(refs.slice(i,i+3).map(
    x=>source(x.invoiceNo,x.id,catalogue,
     {allowMissingPhone:x.confirmedPhoneMissing===true})));
   found.push(...chunk);
  }
  if(found.some(x=>x.revision!==catalogue.revision))
   fail('OWNER_LEDGER_SOURCE_MISMATCH');
  return found;
 }
 function normalizeItems(lines,productMap,discount){
  if(!Array.isArray(lines)||!lines.length||lines.length>6)fail('OWNER_ITEMS_NEED_REVIEW');
  let count=0,subtotal=0;const seen=new Set();
  const out=lines.map(entry=>{
   const code=clean(entry.code),qty=entry.qty,p=productMap.get(code);
   if(!p||seen.has(code)||!Number.isSafeInteger(qty)||qty<1||qty>500)
    fail('OWNER_ITEMS_NEED_REVIEW');
   seen.add(code);count+=qty;
   const unitPrice=Math.round(p.listPrice*(100-discount)/100);
   subtotal+=qty*unitPrice;
   return {code,product:p.name,unit:p.unit,qty,listPrice:p.listPrice,unitPrice};
  });
  if(count>500||subtotal>1e11)fail('OWNER_ITEMS_NEED_REVIEW');
  return {items:out,subtotal};
 }
 async function interpret(message,customer){
  if(typeof message!=='string'||message.length<4||message.length>600||
     identityChange(message,customer))fail('OWNER_REQUEST_NEEDS_CLARIFICATION');
  const {orderText,noteText}=splitOrderAndNote(message);
  if(!orderText)fail('OWNER_REQUEST_NEEDS_CLARIFICATION');
  const parsed= parseMultiOrder(orderText,customer);
  let lines;
  if(parsed?.items&&!parsed.needMoreDetails)
   lines=parsed.items.map(x=>({code:productFor(x.sku)?.code,qty:x.qty}));
  else if(parsed?.needMoreDetails)fail('OWNER_REQUEST_NEEDS_CLARIFICATION');
  else{
   const one=await parseOrder(orderText,customer);
   if(one?.intent!=='order'||one.needMoreDetails||one.needsHuman||
      !Number.isSafeInteger(one.qty)||one.qty<1||
      !productFor(one.sku))fail('OWNER_REQUEST_NEEDS_CLARIFICATION');
   lines=[{code:productFor(one.sku).code,qty:one.qty}];
  }
  const note=clean(noteText).slice(0,300);
  return {lines,note,parser:'Gemini-and-rules'};
 }
 function seal(q){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',
   secretKey(policy(env).adminSecret),iv);
  const body=Buffer.concat([cipher.update(JSON.stringify(q),'utf8'),cipher.final()]);
  return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),
   body.toString('base64url')].join('.');
 }
 function unseal(raw){
  if(typeof raw!=='string'||raw.length>6000||raw.length<40)fail('OWNER_QUOTE_INVALID');
  try{
   const parts=raw.split('.');if(parts.length!==3)fail('OWNER_QUOTE_INVALID');
   const iv=Buffer.from(parts[0],'base64url'),tag=Buffer.from(parts[1],'base64url');
   if(iv.length!==12||tag.length!==16)fail('OWNER_QUOTE_INVALID');
   const dec=crypto.createDecipheriv('aes-256-gcm',
    secretKey(policy(env).adminSecret),iv);
   dec.setAuthTag(tag);
   return JSON.parse(Buffer.concat([dec.update(Buffer.from(parts[2],'base64url')),
    dec.final()]).toString('utf8'));
  }catch{fail('OWNER_QUOTE_INVALID')}
 }
 async function preview({authenticated,invoiceNo,message,discountPercent,shippingPercent,
  vatPercent=0}={}){
  if(authenticated!==true)fail('OWNER_AUTH_REQUIRED');
  policy(env);
  if(!pct(discountPercent)||!pct(shippingPercent,30)||![0,5,8,10].includes(vatPercent))
   fail('OWNER_PRICE_APPROVAL_REQUIRED');
  const live=await source(invoiceNo),order=await interpret(message,live.customer);
  const {items,subtotal}=normalizeItems(order.lines,live.products,discountPercent);
  const ship=Math.round(subtotal*shippingPercent/100),vat=Math.round(subtotal*vatPercent/100);
  const total=subtotal+ship+vat;
  if(!Number.isSafeInteger(total)||total<=0)fail('OWNER_INVALID_TOTAL');
  const q={id:'owner_'+newId(),revision:live.revision,invoiceNo,
   customerRef:{id:live.customer.id,invoiceNo},
   name:live.customer.name,phone:live.customer.phone,location:live.customer.location,
   items,shippingAmount:ship,vatAmount:vat,total,deliveryNote:order.note,
   discountPercent,shippingPercent,vatPercent,expiresAt:now()+600000};
  if(intents.has(q.id))fail('OWNER_REQUEST_ID_COLLISION');
  const sealed=seal(q);
  return {quoteToken:sealed,expiresAt:q.expiresAt,
   quoteId:q.id,revision:q.revision,
   customer:{name:q.name,phone:q.phone,location:q.location},
   items:items.map(({code,product,qty,unit,unitPrice})=>({code,product,qty,unit,unitPrice})),
   shippingAmount:ship,vatAmount:vat,total,deliveryNote:q.deliveryNote,
   discountPercent,shippingPercent,vatPercent,parser:order.parser,
   confirmationRequired:true,productionWrite:false};
 }
 async function confirm({authenticated,quoteToken,confirmedByOwner=false}={}){
  if(authenticated!==true)fail('OWNER_AUTH_REQUIRED');
  if(confirmedByOwner!==true)fail('OWNER_CONFIRMATION_REQUIRED');
  policy(env);
  const q=unseal(quoteToken);
  if(!/^owner_[A-Za-z0-9_-]{8,100}$/.test(q.id)||!Number.isSafeInteger(q.revision)||
     !Number.isSafeInteger(q.expiresAt)||q.expiresAt<=now()||
     q.expiresAt>now()+600000)fail('OWNER_QUOTE_EXPIRED');
  const previous=intents.get(q.id);
  if(previous&&previous.fingerprint!==digest(q))fail('OWNER_REQUEST_ID_COLLISION');
  if(previous?.status==='confirmed')
   return {...previous.result,duplicate:true};
  if(previous)fail('OWNER_COMMIT_UNCERTAIN_RECONCILE');
  const live=await source(q.invoiceNo);
  if(live.revision!==q.revision||
   String(live.customer.id)!==String(q.customerRef.id)||
   live.customer.name!==q.name||live.customer.phone!==q.phone||
   live.customer.location!==q.location)fail('OWNER_QUOTE_STALE');
  const {items,subtotal}=normalizeItems(q.items,live.products,q.discountPercent);
  if(digest(items)!==digest(q.items)||Math.round(subtotal*q.shippingPercent/100)!==q.shippingAmount||
     Math.round(subtotal*q.vatPercent/100)!==q.vatAmount||
     subtotal+q.shippingAmount+q.vatAmount!==q.total)
   fail('OWNER_QUOTE_STALE');
  // Do not allow a second POST after lost reply, even within the same process.
  intents.set(q.id,{status:'sending',fingerprint:digest(q)});
  let reply;
  try{
   reply=await bot('orders.create',{requestId:q.id,expectedRevision:q.revision,
    confirmedNewCustomer:false,customerRef:q.customerRef,
    order:{name:q.name,phone:q.phone,location:q.location,items:q.items,
     shippingAmount:q.shippingAmount,vatAmount:q.vatAmount,total:q.total,
     deliveryNote:q.deliveryNote}});
  }catch(e){intents.set(q.id,{status:'uncertain',fingerprint:digest(q)});throw e}
  const saved=reply.data?.order;
  if(!Number.isSafeInteger(saved?.invoiceNo)||saved.invoiceNo<1||
    Number(saved.total)!==q.total||saved.name!==q.name||
    saved.location!==q.location||saved.phone!==q.phone){
   intents.set(q.id,{status:'uncertain'});fail('OWNER_COMMIT_UNCERTAIN_RECONCILE');
  }
  const result={invoiceNo:saved.invoiceNo,revision:reply.revision,
   total:saved.total,duplicate:reply.data.duplicate===true,
   confirmedByAuthoritativeLedger:true};
  intents.set(q.id,{status:'confirmed',fingerprint:digest(q),result});
  return result;
 }
 return Object.freeze({readiness,probeWriter,preview,confirm,source,sourceBatch,bot});
}
