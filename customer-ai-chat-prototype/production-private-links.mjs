/**
 * Private, owner-issued production checkout invitations.
 * Completely separate from sandbox profiles. No production customer data is
 * persisted on Render's ephemeral disk and no real order is ever auto-created.
 *
 * The server-side owner HMAC key encrypts the scoped invitation and quote.
 * A separate random access code must be given to the intended recipient.
 * Google Drive Bot API owns invoice numbers, concurrency and requestId dedupe.
 */
import crypto from 'node:crypto';

const error=code=>Object.assign(new Error(code),{code});
const safe=v=>String(v??'').trim();
const digits=v=>safe(v).replace(/\D/g,'');
const money=v=>Number.isSafeInteger(v)&&v>=0&&v<=1e11;
const pct=(v,max=70)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const validRef=v=>v&&v.id!=null&&Number.isSafeInteger(v.invoiceNo)&&v.invoiceNo>0;
const cleanText=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const keyFromSecret=v=>crypto.createHash('sha256').update('MINH-SATORI-REAL-LINK-V1\0'+v).digest();
const maxAge=30*24*3600*1000;

export function createProductionPrivateLinks({
 env=process.env, now=Date.now, rand=crypto.randomBytes, source, bot,
 origin='https://minh-satori-customer-ai-gemini.onrender.com'
}={}){
 if(typeof source!=='function'||typeof bot!=='function')throw Error('SERVER_BINDINGS_REQUIRED');
 function key(){
  const secret=safe(env.SATORI_OWNER_CHECKOUT_SECRET||env.SATORI_BOT_SECRET);
  if(env.GEMINI_PRODUCTION_LINKS_ENABLED!=='1'||
     env.GEMINI_OWNER_ONLY_REAL_PILOT!=='1'||
     env.GEMINI_SANDBOX_EMERGENCY_DEMO_ONLY==='1'||
     secret.length<32)throw error('REAL_LINKS_NOT_ENABLED');
  return keyFromSecret(secret);
 }
 function seal(value,context){
  const iv=rand(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
  return [iv,cipher.getAuthTag(),ciphertext].map(v=>v.toString('base64url')).join('.');
 }
 function unseal(token,context){
  if(typeof token!=='string'||token.length<80||token.length>8000||!(/^[A-Za-z0-9_.-]+$/).test(token))
   throw error('INVALID_REAL_LINK');
  try{
   const p=token.split('.');
   if(p.length!==3)throw Error('TOKEN_PARTS');
   const iv=Buffer.from(p[0],'base64url'),tag=Buffer.from(p[1],'base64url');
   if(iv.length!==12||tag.length!==16)throw Error('TOKEN_BYTES');
   const d=crypto.createDecipheriv('aes-256-gcm',key(),iv);
   d.setAAD(Buffer.from(context));d.setAuthTag(tag);
   return JSON.parse(Buffer.concat([d.update(Buffer.from(p[2],'base64url')),d.final()]).toString());
  }catch(e){if(e?.code==='REAL_LINKS_NOT_ENABLED')throw e;throw error('INVALID_REAL_LINK')}
 }
 function access(inviteToken,accessCode){
  const invite=unseal(inviteToken,'customer-invite');
  if(invite.type!=='customer-invite'||!Number.isSafeInteger(invite.expiresAt)||
     invite.expiresAt<=now()||invite.expiresAt>now()+maxAge||
     !validRef(invite.customerRef)||!pct(invite.discountPercent)||
     !pct(invite.shippingPercent,30)||![0,5,8,10].includes(invite.vatPercent)||
     !/^[a-f0-9]{64}$/.test(invite.codeDigest||''))
   throw error('REAL_LINK_EXPIRED_OR_INVALID');
  if(typeof accessCode!=='string'||accessCode.length>100)throw error('ACCESS_CODE_REQUIRED');
  const candidate=Buffer.from(sha(invite.id+'\0'+accessCode),'hex');
  const expected=Buffer.from(invite.codeDigest,'hex');
  if(!crypto.timingSafeEqual(candidate,expected))throw error('ACCESS_CODE_REQUIRED');
  return invite;
 }
 async function checked(invite){
  const live=await source(invite.customerRef.invoiceNo);
  if(String(live.customer.id)!==String(invite.customerRef.id)||
     live.customer.name!==invite.name||digits(live.customer.phone)!==digits(invite.phone)||
     live.customer.location!==invite.location)throw error('REAL_CUSTOMER_SOURCE_CHANGED');
  return live;
 }
 function priced(invite,live,requested){
  if(!Array.isArray(requested)||requested.length<1||requested.length>6)throw error('INVALID_REAL_BASKET');
  let subtotal=0,count=0;const seen=new Set();
  const items=requested.map(x=>{
   if(!x||typeof x.code!=='string'||!/^TP-[0-9]{5}$/.test(x.code)||
      seen.has(x.code)||!Number.isSafeInteger(x.qty)||x.qty<1||x.qty>500)
    throw error('INVALID_REAL_BASKET');
   seen.add(x.code);count+=x.qty;
   const p=live.products.get(x.code);
   if(!p||!money(p.listPrice)||!safe(p.name)||!safe(p.unit))
    throw error('REAL_CATALOGUE_CHANGED');
   const unitPrice=Math.round(p.listPrice*(100-invite.discountPercent)/100);
   subtotal+=unitPrice*x.qty;
   return {code:x.code,product:p.name,unit:p.unit,qty:x.qty,listPrice:p.listPrice,unitPrice};
  });
  if(count>500||subtotal>1e11)throw error('INVALID_REAL_BASKET');
  const shippingAmount=Math.round(subtotal*invite.shippingPercent/100);
  const vatAmount=Math.round(subtotal*invite.vatPercent/100);
  const total=subtotal+shippingAmount+vatAmount;
  if(!money(total)||total<=0)throw error('INVALID_REAL_TOTAL');
  return {items,subtotal,shippingAmount,vatAmount,total};
 }
 function readiness(){
  try{key();return {configured:true,customerLinkIssuanceWired:true,requiresAccessCode:true,
    backendWriteVerified:false,accessExpiresWithinDays:30}}
  catch(e){return {configured:false,customerLinkIssuanceWired:true,reason:e.code||'NO_PRIVATE_KEY',
    backendWriteVerified:false}}
 }
 async function issue(input){
  key();
  if(!input||input.confirmation!=='OWNER_APPROVES_REAL_CUSTOMER_LINK'||
     !validRef(input.customerRef)||!pct(input.discountPercent)||
     !pct(input.shippingPercent,30)||![0,5,8,10].includes(input.vatPercent)||
     !Number.isSafeInteger(input.daysValid)||input.daysValid<1||input.daysValid>30)
   throw error('REAL_LINK_APPROVAL_REQUIRED');
  const live=await source(input.customerRef.invoiceNo);
  if(String(live.customer.id)!==String(input.customerRef.id)||
     !cleanText(live.customer.name,150)||!cleanText(live.customer.location,500)||
     digits(live.customer.phone).length<8||
     safe(input.name)!==live.customer.name||
     digits(input.phone)!==digits(live.customer.phone)||
     safe(input.location)!==live.customer.location)
   throw error('REAL_CUSTOMER_REFERENCE_MISMATCH');
  // Never mint one ambiguous link for several real people or delivery points.
  const id=rand(16).toString('hex'),accessCode=rand(20).toString('base64url');
  const invite={type:'customer-invite',id,issuedAt:now(),
   expiresAt:now()+input.daysValid*86400000,
   customerRef:{id:live.customer.id,invoiceNo:input.customerRef.invoiceNo},
   name:live.customer.name,phone:live.customer.phone,location:live.customer.location,
   discountPercent:input.discountPercent,shippingPercent:input.shippingPercent,
   vatPercent:input.vatPercent,codeDigest:sha(id+'\0'+accessCode)};
  const token=seal(invite,'customer-invite');
  return {ok:true,production:true,oneLocationPerLink:true,
   link:origin.replace(/\/$/,'')+'/real/'+token,
   accessCode,expiresAt:new Date(invite.expiresAt).toISOString(),
   customer:{name:invite.name,location:invite.location,sourceInvoiceNo:input.customerRef.invoiceNo},
   note:'Chia sẻ link và mã truy cập qua hai kênh riêng. Mã chỉ hiển thị một lần.'};
 }
 async function catalogue({token,accessCode}={}){
  const invite=access(token,accessCode),live=await checked(invite);
  return {production:true,customer:{name:invite.name,phone:invite.phone,location:invite.location},
   expiresAt:new Date(invite.expiresAt).toISOString(),revision:live.revision,
   discountPercent:invite.discountPercent,shippingPercent:invite.shippingPercent,
   vatPercent:invite.vatPercent,
   products:[...live.products.values()].map(p=>({code:p.code,name:p.name,unit:p.unit,
    listPrice:p.listPrice,unitPrice:Math.round(p.listPrice*(100-invite.discountPercent)/100)}))};
 }
 async function quote({token,accessCode,items,deliveryNote=''}={}){
  const invite=access(token,accessCode);
  if(!cleanText(deliveryNote,300))throw error('INVALID_DELIVERY_NOTE');
  const live=await checked(invite),amount=priced(invite,live,items);
  const q={type:'customer-real-quote',inviteId:invite.id,
   sourceRevision:live.revision,requestId:'rl_'+rand(18).toString('hex'),
   customerRef:invite.customerRef,issuedAt:now(),expiresAt:now()+600000,
   items:amount.items,deliveryNote,shippingAmount:amount.shippingAmount,
   vatAmount:amount.vatAmount,total:amount.total};
  return {production:true,confirmationRequired:true,quoteToken:seal(q,'customer-quote'),
   expiresAt:new Date(q.expiresAt).toISOString(),sourceRevision:live.revision,
   ...amount,customer:{name:invite.name,location:invite.location}};
 }
 async function confirm({token,accessCode,quoteToken,confirmation}={}){
  const invite=access(token,accessCode);
  if(confirmation!=='CUSTOMER_CONFIRMS_REAL_ORDER')throw error('REAL_CONFIRMATION_REQUIRED');
  const q=unseal(quoteToken,'customer-quote');
  if(q.type!=='customer-real-quote'||q.inviteId!==invite.id||
     q.expiresAt<=now()||q.expiresAt>now()+600000||
     !Number.isSafeInteger(q.sourceRevision)||
     !/^rl_[a-f0-9]{36}$/.test(q.requestId||'')||
     String(q.customerRef?.id)!==String(invite.customerRef.id)||
     q.customerRef?.invoiceNo!==invite.customerRef.invoiceNo)
   throw error('REAL_QUOTE_INVALID');
  const live=await checked(invite);
  if(live.revision!==q.sourceRevision)throw error('REAL_QUOTE_STALE');
  const price=priced(invite,live,q.items.map(x=>({code:x.code,qty:x.qty})));
  if(JSON.stringify(price.items)!==JSON.stringify(q.items)||
     price.shippingAmount!==q.shippingAmount||
     price.vatAmount!==q.vatAmount||price.total!==q.total||
     !cleanText(q.deliveryNote,300))throw error('REAL_QUOTE_STALE');
  let receipt;
  try{
   receipt=await bot('orders.create',{
    requestId:q.requestId,expectedRevision:q.sourceRevision,
    customerRef:q.customerRef,
    confirmedNewCustomer:false,
    order:{name:invite.name,phone:invite.phone,location:invite.location,
     items:q.items,shippingAmount:q.shippingAmount,vatAmount:q.vatAmount,
     total:q.total,deliveryNote:q.deliveryNote}
   });
  }catch(e){throw error('REAL_WRITE_UNCERTAIN_RECONCILE_WITH_OWNER')}
  const order=receipt.data?.order;
  if(!order||!Number.isSafeInteger(order.invoiceNo)||
     order.name!==invite.name||order.location!==invite.location||
     Number(order.total)!==q.total)throw error('REAL_WRITE_UNCERTAIN_RECONCILE_WITH_OWNER');
  return {production:true,saved:true,invoiceNo:order.invoiceNo,
   revision:receipt.revision,total:order.total,duplicate:receipt.data?.duplicate===true,
   message:'Đã ghi hóa đơn thật vào sổ kế toán Minh Satori.'};
 }
 return Object.freeze({readiness,issue,catalogue,quote,confirm});
}
