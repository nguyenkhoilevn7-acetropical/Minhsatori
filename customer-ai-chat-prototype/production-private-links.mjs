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
import zlib from 'node:zlib';

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
const sameRef=(a,b)=>a&&b&&String(a.id)===String(b.id)&&a.invoiceNo===b.invoiceNo;
const validDestination=d=>validRef(d?.customerRef)&&cleanText(d.name,150)&&cleanText(d.location,500)&&digits(d.phone).length>=8&&pct(d.discountPercent);

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
  const source=Buffer.from(JSON.stringify(value),'utf8');
  const contents=context==='customer-invite'&&value?.type==='agency-invite'?
   zlib.deflateRawSync(source):source;
  const ciphertext=Buffer.concat([cipher.update(contents),cipher.final()]);
  return [iv,cipher.getAuthTag(),ciphertext].map(v=>v.toString('base64url')).join('.');
 }
 function unseal(token,context){
  if(typeof token!=='string'||token.length<80||token.length>30000||!(/^[A-Za-z0-9_.-]+$/).test(token))
   throw error('INVALID_REAL_LINK');
  try{
   const p=token.split('.');
   if(p.length!==3)throw Error('TOKEN_PARTS');
   const iv=Buffer.from(p[0],'base64url'),tag=Buffer.from(p[1],'base64url');
   if(iv.length!==12||tag.length!==16)throw Error('TOKEN_BYTES');
   const d=crypto.createDecipheriv('aes-256-gcm',key(),iv);
   d.setAAD(Buffer.from(context));d.setAuthTag(tag);
   const plaintext=Buffer.concat([d.update(Buffer.from(p[2],'base64url')),d.final()]);
   try{return JSON.parse(plaintext.toString('utf8'))}
   catch{
    if(context!=='customer-invite')throw error('INVALID_REAL_LINK');
    const raw=zlib.inflateRawSync(plaintext,{maxOutputLength:25000});
    return JSON.parse(raw.toString('utf8'));
   }
  }catch(e){if(e?.code==='REAL_LINKS_NOT_ENABLED')throw e;throw error('INVALID_REAL_LINK')}
 }
 function access(inviteToken,accessCode){
  const invite=unseal(inviteToken,'customer-invite');
  const agency=invite.type==='agency-invite';
  const destinations=agency?invite.destinations:[invite];
  if(!['agency-invite','customer-invite'].includes(invite.type)||
     !Number.isSafeInteger(invite.expiresAt)||
     invite.expiresAt<=now()||invite.expiresAt>now()+maxAge||
     !pct(invite.shippingPercent,30)||![0,5,8,10].includes(invite.vatPercent)||
     !Array.isArray(destinations)||destinations.length<1||destinations.length>20||
     !destinations.every(validDestination)||
     (agency&&(!cleanText(invite.agentName,150)||
       new Set(destinations.map(d=>String(d.customerRef.id)+'|'+d.customerRef.invoiceNo)).size!==destinations.length))||
     !/^[a-f0-9]{64}$/.test(invite.codeDigest||''))
    throw error('REAL_LINK_EXPIRED_OR_INVALID');
  if(typeof accessCode!=='string'||accessCode.length>100)throw error('ACCESS_CODE_REQUIRED');
  const candidate=Buffer.from(sha(invite.id+'\0'+accessCode),'hex');
  const expected=Buffer.from(invite.codeDigest,'hex');
  if(!crypto.timingSafeEqual(candidate,expected))throw error('ACCESS_CODE_REQUIRED');
  return invite;
 }
 function destinations(invite){return invite.type==='agency-invite'?invite.destinations:[invite]}
 function chosen(invite,ref){
  const available=destinations(invite);
  if(invite.type==='agency-invite'&&!validRef(ref))throw error('REAL_DESTINATION_REQUIRED');
  const d=invite.type==='agency-invite'?available.find(x=>sameRef(x.customerRef,ref)):available[0];
  if(!d)throw error('REAL_DESTINATION_NOT_APPROVED');
  return d;
 }
 async function checked(invite,destination){
  const d=destination||chosen(invite);
  const live=await source(d.customerRef.invoiceNo,d.customerRef.id);
  if(String(live.customer.id)!==String(d.customerRef.id)||
     live.customer.name!==d.name||digits(live.customer.phone)!==digits(d.phone)||
     live.customer.location!==d.location)throw error('REAL_CUSTOMER_SOURCE_CHANGED');
  return live;
 }
 function priced(destination,live,requested){
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
   const unitPrice=Math.round(p.listPrice*(100-destination.discountPercent)/100);
   subtotal+=unitPrice*x.qty;
   return {code:x.code,product:p.name,unit:p.unit,qty:x.qty,listPrice:p.listPrice,unitPrice};
  });
  if(count>500||subtotal>1e11)throw error('INVALID_REAL_BASKET');
  const shippingAmount=Math.round(subtotal*destination.shippingPercent/100);
  const vatAmount=Math.round(subtotal*destination.vatPercent/100);
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
 async function probeWriteScope(){
  // The current Bot API checks write scope before validating the empty payload.
  // Empty payload fails INVALID_REQUEST prior to version check or mutation.
  // This is a non-mutating scope proof; never create a test invoice in production.
  try{await bot('orders.create',{});}
  catch(e){
   if(e?.code==='INVALID_REQUEST')return true;
   throw error('REAL_BOT_WRITE_SCOPE_NOT_VERIFIED');
  }
  throw error('REAL_BOT_WRITE_PROBE_INVALID');
 }
 async function issue(input){
  key();
  const multi=Array.isArray(input?.destinations);
  if(!input||input.confirmation!=='OWNER_APPROVES_REAL_CUSTOMER_LINK'||
     !pct(input.shippingPercent,30)||![0,5,8,10].includes(input.vatPercent)||
     !Number.isSafeInteger(input.daysValid)||input.daysValid<1||input.daysValid>30||
     (multi?(!cleanText(input.agentName,150)||input.destinations.length<1||
       input.destinations.length>20||input.destinations.some(x=>!Number.isSafeInteger(x?.customerRef?.invoiceNo)||x.customerRef.invoiceNo<1||!pct(x.discountPercent))||
       new Set(input.destinations.map(x=>String(x.customerRef.id)+'|'+x.customerRef.invoiceNo)).size!==input.destinations.length):
      (!validRef(input.customerRef)||!pct(input.discountPercent))))
    throw error('REAL_LINK_APPROVAL_REQUIRED');
  await probeWriteScope();
  // The exact historical recipient and location must be verified from Drive;
  // clients may only choose an owner-authorized invoice reference and rate.
  const refs=multi?input.destinations:[input];
  const approved=[];
  for(const requested of refs){
   const live=await source(requested.customerRef.invoiceNo,requested.customerRef.id);
   if((requested.customerRef.id!=null&&String(live.customer.id)!==String(requested.customerRef.id))||
      !cleanText(live.customer.name,150)||!cleanText(live.customer.location,500)||
      digits(live.customer.phone).length<8||
      (requested.name!==undefined&&safe(requested.name)!==live.customer.name)||
      (requested.phone!==undefined&&digits(requested.phone)!==digits(live.customer.phone))||
      (requested.location!==undefined&&safe(requested.location)!==live.customer.location))
     throw error('REAL_CUSTOMER_REFERENCE_MISMATCH');
   approved.push({customerRef:{id:live.customer.id,invoiceNo:requested.customerRef.invoiceNo},
     name:live.customer.name,phone:live.customer.phone,location:live.customer.location,
     discountPercent:multi?requested.discountPercent:input.discountPercent,
     shippingPercent:input.shippingPercent,vatPercent:input.vatPercent});
  }
  const id=rand(16).toString('hex'),accessCode=rand(20).toString('base64url');
  const invite={type:multi?'agency-invite':'customer-invite',id,issuedAt:now(),
   expiresAt:now()+input.daysValid*86400000,
   ...(multi?{agentName:input.agentName,destinations:approved}:approved[0]),
   shippingPercent:input.shippingPercent,vatPercent:input.vatPercent,
   codeDigest:sha(id+'\0'+accessCode)};
  const token=seal(invite,'customer-invite');
  return {ok:true,production:true,oneLocationPerLink:!multi,agencyLink:multi,
   deliveryLocations:approved.length,
   link:origin.replace(/\/$/,'')+'/real/#'+token,
   accessCode,expiresAt:new Date(invite.expiresAt).toISOString(),
   ...(multi?{agentName:input.agentName}:{customer:{name:approved[0].name,location:approved[0].location,sourceInvoiceNo:input.customerRef.invoiceNo}}),
   note:'Chia sẻ link và mã truy cập qua hai kênh riêng. Mã chỉ hiển thị một lần.'};
 }
 // For conversational parsing ONLY: verify sealed invitation, independent PIN and
 // owner-approved destination without querying Drive for each keystroke/message.
 // All prices and invoice writes still revalidate CURRENT Drive data at quote/confirm.
 function chatContext({token,accessCode,destination:ref}={}){
  const invite=access(token,accessCode),d=chosen(invite,ref);
  return {production:true,customer:{name:d.name,phone:d.phone,location:d.location},
   destination:d.customerRef};
 }
 async function catalogue({token,accessCode,destination:ref}={}){
  const invite=access(token,accessCode),agency=invite.type==='agency-invite';
  const d=agency?(ref?chosen(invite,ref):null):chosen(invite);
  // No disclosure until both independent credentials are verified.
  // When an agent has not selected an address, return no priced catalogue.
  if(!d)return {production:true,agency:true,agentName:invite.agentName,
    destinations:destinations(invite).map(x=>({customerRef:x.customerRef,name:x.name,location:x.location,discountPercent:x.discountPercent})),
    products:[],requiresDestination:true};
  const live=await checked(invite,d);
  return {production:true,agency,agentName:invite.agentName||null,
   ...(agency?{destinations:destinations(invite).map(x=>({customerRef:x.customerRef,name:x.name,location:x.location,discountPercent:x.discountPercent}))}:{}),
   customer:{name:d.name,phone:d.phone,location:d.location},
   expiresAt:new Date(invite.expiresAt).toISOString(),revision:live.revision,
   discountPercent:d.discountPercent,shippingPercent:d.shippingPercent,
   vatPercent:d.vatPercent,
   products:[...live.products.values()].map(p=>({code:p.code,name:p.name,unit:p.unit,
    listPrice:p.listPrice,unitPrice:Math.round(p.listPrice*(100-d.discountPercent)/100)}))};
 }
 async function quote({token,accessCode,destination:ref,items,deliveryNote=''}={}){
  const invite=access(token,accessCode),d=chosen(invite,ref);
  if(!cleanText(deliveryNote,300))throw error('INVALID_DELIVERY_NOTE');
  const live=await checked(invite,d),amount=priced(d,live,items);
  const q={type:'customer-real-quote',inviteId:invite.id,
   sourceRevision:live.revision,requestId:'rl_'+rand(18).toString('hex'),
   customerRef:d.customerRef,issuedAt:now(),expiresAt:now()+600000,
   items:amount.items,deliveryNote,shippingAmount:amount.shippingAmount,
   vatAmount:amount.vatAmount,total:amount.total,discountPercent:d.discountPercent};
  return {production:true,confirmationRequired:true,quoteToken:seal(q,'customer-quote'),
   expiresAt:new Date(q.expiresAt).toISOString(),sourceRevision:live.revision,
   ...amount,discountPercent:d.discountPercent,customer:{name:d.name,location:d.location}};
 }
 async function confirm({token,accessCode,quoteToken,confirmation}={}){
  const invite=access(token,accessCode);
  if(confirmation!=='CUSTOMER_CONFIRMS_REAL_ORDER')throw error('REAL_CONFIRMATION_REQUIRED');
  const q=unseal(quoteToken,'customer-quote');
  if(q.type!=='customer-real-quote'||q.inviteId!==invite.id||
     q.expiresAt<=now()||q.expiresAt>now()+600000||
     !Number.isSafeInteger(q.sourceRevision)||
     !/^rl_[a-f0-9]{36}$/.test(q.requestId||'')||
     !validRef(q.customerRef))
   throw error('REAL_QUOTE_INVALID');
  const destination=chosen(invite,q.customerRef);
  if(!sameRef(destination.customerRef,q.customerRef)||
     q.discountPercent!==undefined&&q.discountPercent!==destination.discountPercent)
   throw error('REAL_QUOTE_STALE');
  const live=await checked(invite,destination);
  if(live.revision!==q.sourceRevision)throw error('REAL_QUOTE_STALE');
  const price=priced(destination,live,q.items.map(x=>({code:x.code,qty:x.qty})));
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
    order:{name:destination.name,phone:destination.phone,location:destination.location,
     items:q.items,shippingAmount:q.shippingAmount,vatAmount:q.vatAmount,
     total:q.total,deliveryNote:q.deliveryNote}
   });
  }catch(e){throw error('REAL_WRITE_UNCERTAIN_RECONCILE_WITH_OWNER')}
  const order=receipt.data?.order;
  if(!order||!Number.isSafeInteger(order.invoiceNo)||
     order.name!==destination.name||order.location!==destination.location||
     Number(order.total)!==q.total)throw error('REAL_WRITE_UNCERTAIN_RECONCILE_WITH_OWNER');
  return {production:true,saved:true,invoiceNo:order.invoiceNo,
   revision:receipt.revision,total:order.total,duplicate:receipt.data?.duplicate===true,
   message:'Đã ghi hóa đơn thật vào sổ kế toán Minh Satori.'};
 }
 return Object.freeze({readiness,probeWriteScope,issue,catalogue,quote,confirm,chatContext});
}
