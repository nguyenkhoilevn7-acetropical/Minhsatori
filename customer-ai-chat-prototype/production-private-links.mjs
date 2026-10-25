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
 env=process.env, now=Date.now, rand=crypto.randomBytes, source, sourceBatch=null, bot,historyReader=null,
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
  const live=await source(d.customerRef.invoiceNo,d.customerRef.id,null,
   {allowMissingPhone:d.ownerVerifiedPhone===true});
  // A manually verified phone is allowed only while the EXACT signed source
  // invoice still has no contact. If source is subsequently corrected the
  // owner must reissue the link from its new authoritative contact.
  const phoneMatches=d.ownerVerifiedPhone===true?
   digits(live.customer.phone)===''&&/^\\d{9,11}$/.test(d.phone):
   digits(live.customer.phone)===digits(d.phone);
  if(String(live.customer.id)!==String(d.customerRef.id)||
     live.customer.name!==d.name||!phoneMatches||
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
  // Use one consistent catalogue snapshot and a bounded batch for many destinations.
  // Source validation is still per invoice; no customer identity is inferred.
  const verified=multi&&typeof sourceBatch==='function'?
   await sourceBatch(refs.map(x=>({...x.customerRef,
    confirmedPhoneMissing:x.confirmedPhoneMissing===true}))):null;
  for(const [index,requested] of refs.entries()){
   const ownerVerified=requested.confirmedPhoneMissing===true&&
     typeof requested.verifiedPhone==='string'&&
     /^\\d{9,11}$/.test(requested.verifiedPhone);
   // No owner-verified phone without a concrete verified invoice row.
   if((requested.confirmedPhoneMissing===true&&!ownerVerified)||
      (requested.verifiedPhone!==undefined&&!ownerVerified))
    throw error('OWNER_PHONE_VERIFICATION_REQUIRED');
   const live=verified?verified[index]:await source(requested.customerRef.invoiceNo,requested.customerRef.id,null,
    {allowMissingPhone:ownerVerified});
   if(ownerVerified&&digits(live.customer.phone)!=='')
    throw error('OWNER_PHONE_VERIFICATION_CONFLICT');
   if(!live?.customer||!Number.isSafeInteger(live.revision)||
      (verified&&live.revision!==verified[0]?.revision)||(requested.customerRef.id!=null&&String(live.customer.id)!==String(requested.customerRef.id))||
      !cleanText(live.customer.name,150)||!cleanText(live.customer.location,500)||
      (!ownerVerified&&digits(live.customer.phone).length<8)||
      (requested.name!==undefined&&safe(requested.name)!==live.customer.name)||
      (requested.phone!==undefined&&digits(requested.phone)!==digits(live.customer.phone))||
      (requested.location!==undefined&&safe(requested.location)!==live.customer.location))
     throw error('REAL_CUSTOMER_REFERENCE_MISMATCH');
   approved.push({customerRef:{id:live.customer.id,invoiceNo:requested.customerRef.invoiceNo},
     name:live.customer.name,phone:ownerVerified?requested.verifiedPhone:live.customer.phone,
     location:live.customer.location,
     ...(ownerVerified?{ownerVerifiedPhone:true}:{}),
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
   issuedAt:new Date(invite.issuedAt).toISOString(),
   recipients:approved.map(x=>({customerRef:x.customerRef,name:x.name,
    phone:x.phone,location:x.location,discountPercent:x.discountPercent})),
   shippingPercent:invite.shippingPercent,vatPercent:invite.vatPercent,
   link:origin.replace(/\/$/,'')+'/real/#'+token,
   accessCode,expiresAt:new Date(invite.expiresAt).toISOString(),
   ...(multi?{agentName:input.agentName}:{customer:{name:approved[0].name,location:approved[0].location,sourceInvoiceNo:input.customerRef.invoiceNo}}),
   note:'Chia sẻ link và mã truy cập qua hai kênh riêng. Mã chỉ hiển thị một lần.'};
 }
 // Owner-only recovery of an ALREADY issued encrypted link. An authenticated
 // administrator may paste their old URL to store its exact recipients in the
 // durable Drive directory. Never mint a new invitation or expose its PIN hash.
 function inspectIssuedForOwner({link}={}){
  key();
  const prefix=(origin.endsWith('/')?origin.slice(0,-1):origin)+'/real/#';
  if(typeof link!=='string'||link.length>16000||!link.startsWith(prefix))
   throw error('REAL_LINK_RECOVERY_INVALID');
  const invite=unseal(link.slice(prefix.length),'customer-invite');
  const agency=invite?.type==='agency-invite';
  if(!['agency-invite','customer-invite'].includes(invite?.type)||
     !Number.isSafeInteger(invite.issuedAt)||
     !Number.isSafeInteger(invite.expiresAt)||
     invite.issuedAt>now()+300000||
     invite.expiresAt<=invite.issuedAt||
     invite.expiresAt-invite.issuedAt>maxAge||
     !pct(invite.shippingPercent,30)||
     ![0,5,8,10].includes(invite.vatPercent)||
     (agency&&!cleanText(invite.agentName,150)))
   throw error('REAL_LINK_RECOVERY_INVALID');
  const dest=agency?invite.destinations:[invite];
  if(!Array.isArray(dest)||!dest.length||dest.length>20||
     !dest.every(validDestination)||
     new Set(dest.map(d=>String(d.customerRef.id)+'|'+d.customerRef.invoiceNo)).size!==dest.length)
   throw error('REAL_LINK_RECOVERY_INVALID');
  return {kind:agency?'agency':'customer',
   name:agency?invite.agentName:dest[0].name,
   link,recipients:dest.map(d=>({
    customerRef:{id:String(d.customerRef.id),invoiceNo:d.customerRef.invoiceNo},
    name:d.name,phone:d.phone,location:d.location,discountPercent:d.discountPercent
   })),
   issuedAt:new Date(invite.issuedAt).toISOString(),
   expiresAt:new Date(invite.expiresAt).toISOString(),
   shippingPercent:invite.shippingPercent,vatPercent:invite.vatPercent};
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
    destinations:destinations(invite).map(x=>({customerRef:x.customerRef,name:x.name,phone:x.phone,location:x.location,discountPercent:x.discountPercent})),
    products:[],requiresDestination:true};
  const live=await checked(invite,d);
  return {production:true,agency,agentName:invite.agentName||null,
   ...(agency?{destinations:destinations(invite).map(x=>({customerRef:x.customerRef,name:x.name,phone:x.phone,location:x.location,discountPercent:x.discountPercent}))}:{}),
   customer:{name:d.name,phone:d.phone,location:d.location},
   expiresAt:new Date(invite.expiresAt).toISOString(),revision:live.revision,
   discountPercent:d.discountPercent,shippingPercent:d.shippingPercent,
   vatPercent:d.vatPercent,
   products:[...live.products.values()].map(p=>({code:p.code,name:p.name,unit:p.unit,
    listPrice:p.listPrice,unitPrice:Math.round(p.listPrice*(100-d.discountPercent)/100)}))};
 }
 // Bot orders normally have a millisecond timestamp as their immutable ID.
 // Accept it as an order time only when it agrees with the recorded Vietnamese date.
 function verifiedCreatedAt(order){
  if(!order)return null;
  const millis=Number(order.id);
  if(!Number.isSafeInteger(millis)||millis<946684800000||millis>4102444800000)return null;
  const date=new Date(millis);
  const recorded=String(order.date||'').trim();
  const recordedDay=recorded.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!recordedDay)return null;
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',
   year:'numeric',month:'2-digit',day:'2-digit'});
  const parts=Object.fromEntries(format.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const source=[String(recordedDay[1]).padStart(2,'0'),String(recordedDay[2]).padStart(2,'0'),recordedDay[3]].join('/');
  const derived=[parts.day,parts.month,parts.year].join('/');
  return source===derived?date.toISOString():null;
 }
 async function quote({token,accessCode,destination:ref,items,deliveryNote='',clientOrderId=null}={}){
  const invite=access(token,accessCode),d=chosen(invite,ref);
  if(!cleanText(deliveryNote,300))throw error('INVALID_DELIVERY_NOTE');
  const live=await checked(invite,d),amount=priced(d,live,items);
  // Idempotent at the Google Drive ledger, even for multiple quote confirmations of the same cart.
  // The client cannot choose an arbitrary ledger key; bind its per-cart UUID to the signed invite.
  const requestId=typeof clientOrderId==='string'&&
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientOrderId)?
   'rl_'+sha(invite.id+'\0'+clientOrderId.toLowerCase()).slice(0,36):
   'rl_'+rand(18).toString('hex');
  const q={type:'customer-real-quote',inviteId:invite.id,
   sourceRevision:live.revision,requestId,
   customerRef:d.customerRef,issuedAt:now(),expiresAt:now()+600000,
   items:amount.items,deliveryNote,shippingAmount:amount.shippingAmount,
   vatAmount:amount.vatAmount,total:amount.total,discountPercent:d.discountPercent};
  return {production:true,confirmationRequired:true,quoteToken:seal(q,'customer-quote'),
   expiresAt:new Date(q.expiresAt).toISOString(),sourceRevision:live.revision,
   ...amount,discountPercent:d.discountPercent,customer:{name:d.name,phone:d.phone,location:d.location},deliveryNote};
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
    // GAS matches phone on a historical customerRef. A legacy invoice with
    // blank phone cannot pass that match. Owner-authorised recovery therefore
    // creates a NEW order using the verified phone, never mutating old invoice.
    ...(destination.ownerVerifiedPhone?{}:{customerRef:q.customerRef}),
    confirmedNewCustomer:destination.ownerVerifiedPhone===true,
    order:{name:destination.name,phone:destination.phone,location:destination.location,
     items:q.items,shippingAmount:q.shippingAmount,vatAmount:q.vatAmount,
     total:q.total,deliveryNote:q.deliveryNote}
   });
  }catch(e){throw error('REAL_WRITE_UNCERTAIN_RECONCILE_WITH_OWNER')}
  const order=receipt.data?.order;
  if(!order||!Number.isSafeInteger(order.invoiceNo)||
     order.name!==destination.name||order.location!==destination.location||
     Number(order.total)!==q.total)throw error('REAL_WRITE_UNCERTAIN_RECONCILE_WITH_OWNER');
  // A receipt capability is issued ONLY after the Bot API has verified a
  // committed one-invoice write. Unlike a bare invoice number, this token
  // cannot be used to view unrelated customer invoices.
  const receiptToken=seal({type:'customer-real-receipt',inviteId:invite.id,
   invoiceNo:order.invoiceNo,total:order.total,customerRef:q.customerRef,
   name:destination.name,phone:destination.phone,location:destination.location,
   expiresAt:Math.min(invite.expiresAt,now()+7*86400000)},'customer-receipt');
  return {production:true,saved:true,invoiceNo:order.invoiceNo,
   revision:receipt.revision,total:order.total,duplicate:receipt.data?.duplicate===true,
   createdAt:verifiedCreatedAt(order),receiptToken,message:'Đã ghi hóa đơn thật vào sổ kế toán Minh Satori.'};
 }
 // Verify the immutable invite, separate code AND proof returned by
 // confirmed real order creation. Never grant PDF access by invoiceNo alone.

 const normalized=v=>safe(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/đ/g,'d').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 function receiptProof(invite,d,order){
  return seal({type:'customer-real-receipt',inviteId:invite.id,
   invoiceNo:Number(order.invoiceNo),total:Number(order.total),
   customerRef:d.customerRef,name:d.name,phone:d.phone,location:d.location,
   expiresAt:Math.min(invite.expiresAt,now()+7*86400000)},'customer-receipt');
 }
 /**
  * Owner-approved recipient history, scoped by exact name + phone + physical
  * delivery address. Query is server-controlled; never accept arbitrary
  * customer-search text from public caller. No CTV secondary bills returned.
  * Do NOT equate Satori supplier payment with customer-paid status.
  */
 async function history({token,accessCode}={}){
  const invite=access(token,accessCode);
  const allow=destinations(invite);
  const names=[...new Set(allow.map(d=>normalized(d.name)))];
  if(names.length>20)throw error('REAL_HISTORY_TOO_MANY_DESTINATIONS');
  const reader=historyReader|| (payload=>bot('orders.list',payload));
  const all=[],signatures=new Set();let complete=true,revision=null;
  // The production ledger caps orders.list at 100 entries. For large accounts
  // enumerate disjoint date windows, never silently drop the 101st or older orders.
  let readCount=0;
  async function verifiedRead(payload){
   if(++readCount>96)throw error('REAL_HISTORY_QUERY_LIMIT');
   const source=await reader(payload);
   if(!Number.isSafeInteger(source?.revision)||!Array.isArray(source.data?.orders)||
      !Number.isSafeInteger(source.data?.totalMatches))
    throw error('REAL_HISTORY_SOURCE_INVALID');
   if(revision!==null&&revision!==source.revision)throw error('REAL_HISTORY_REVISION_CHANGED');
   revision=source.revision;
   return source;
  }
  const dayMs=86400000;
  const dayISO=n=>new Date(n).toISOString().slice(0,10);
  async function completeNameHistory(name){
   const initial=await verifiedRead({query:name,limit:100});
   if(initial.data.totalMatches<=initial.data.orders.length)
    return {rows:initial.data.orders,complete:true};
   const from='1970-01-01',to='2100-12-31';
   async function range(start,end,depth=0){
    const found=await verifiedRead({query:name,from:start,to:end,limit:100});
    if(found.data.totalMatches<=found.data.orders.length)
     return {rows:found.data.orders,count:found.data.totalMatches,complete:true};
    const a=Date.parse(start+'T00:00:00Z'),z=Date.parse(end+'T00:00:00Z');
    if(depth>=18||z<=a)return {rows:found.data.orders,count:found.data.totalMatches,complete:false};
    const mid=a+Math.floor((z-a)/dayMs/2)*dayMs;
    const [left,right]=await Promise.all([
     range(start,dayISO(mid),depth+1),
     range(dayISO(mid+dayMs),end,depth+1)
    ]);
    return {rows:[...left.rows,...right.rows],count:left.count+right.count,
     complete:left.complete&&right.complete};
   }
   const paged=await range(from,to);
   return {rows:paged.rows,complete:paged.complete&&paged.count===initial.data.totalMatches};
  }
  for(const name of names){
   // All history stays in Drive. Search is derived only from owner-approved
   // destinations, not arbitrary public input or browser localStorage.
   const found=await completeNameHistory(name);
   const rows=found.rows;
   if(!found.complete)complete=false;
   for(const o of rows){
    if(!Number.isSafeInteger(Number(o.invoiceNo))||Number(o.invoiceNo)<1||
       !Number.isSafeInteger(Number(o.total))||Number(o.total)<0||
       o.pairRole==='collaborator')continue;
    const d=allow.find(x=>normalized(x.name)===normalized(o.name)&&
     normalized(x.location)===normalized(o.location)&&
     digits(x.phone)===digits(o.phone));
    if(!d)continue;
    const id=String(o.id)+'|'+o.invoiceNo+'|'+o.location;
    if(signatures.has(id))continue;
    signatures.add(id);
    all.push({
     invoiceNo:Number(o.invoiceNo),date:safe(o.date).slice(0,20),
     createdAt:verifiedCreatedAt(o),deliveryNote:safe(o.deliveryNote).slice(0,300),
     name:d.name,phone:d.phone,location:d.location,invoiceId:String(o.id),
     total:Number(o.total),status:safe(o.status).slice(0,60),
     paid:o.status==='Đã thanh toán'||!!o.customerPaidAt,
     paidAt:o.customerPaidAt||null,paymentReceiptAt:o.customerPaymentReceiptAt||null,
     paymentNote:safe(o.customerPaymentNote).slice(0,300),
     items:Array.isArray(o.items)?o.items.slice(0,40).map(i=>({
      product:safe(i.product).slice(0,160),qty:Number(i.qty),unit:safe(i.unit).slice(0,40),
      unitPrice:Number(i.unitPrice)
     })):[],
     receiptToken:receiptProof(invite,d,o)
    });
   }
  }
  all.sort((a,b)=>b.invoiceNo-a.invoiceNo);
  return {production:true,revision,complete,orders:all,
   warning:complete?'': 'Một số giao dịch nguồn không có ngày hợp lệ hoặc vượt giới hạn đọc; cần quản trị đối chiếu trước khi khẳng định đủ lịch sử.'};
 }
 /**
  * Authenticated, bounded invoice-status probe during a full-history outage.
  * Returns no personal details; a deletion requires complete exact lookup.
  */
 async function receiptStatuses({token,accessCode,invoiceNos}={}){
  const invite=access(token,accessCode),allowed=destinations(invite);
  if(!Array.isArray(invoiceNos)||invoiceNos.length<1||invoiceNos.length>6||
     invoiceNos.some(n=>!Number.isSafeInteger(n)||n<1)||
     new Set(invoiceNos).size!==invoiceNos.length)throw error('REAL_RECEIPT_STATUS_INVALID');
  const reader=historyReader||(payload=>bot('orders.list',payload));
  // Queries are independent read-only requests. Fetch in parallel so one slow
  // upstream / HMAC fallback does not make the second invoice time out.
  const responses=await Promise.all(invoiceNos.map(invoiceNo=>
   reader({query:String(invoiceNo),limit:100})
  ));
  const revisions=new Set(responses.map(source=>source?.revision));
  if(revisions.size!==1||!Number.isSafeInteger(responses[0]?.revision))
   throw error('REAL_HISTORY_REVISION_CHANGED');
  const revision=responses[0].revision;
  const checks=responses.map((source,i)=>{
   const invoiceNo=invoiceNos[i];
   if(!Array.isArray(source.data?.orders)||
      !Number.isSafeInteger(source.data?.totalMatches)||
      source.data.totalMatches<0||
      source.data.totalMatches>source.data.orders.length)
    throw error('REAL_RECEIPT_STATUS_INCOMPLETE');
   const matched=source.data.orders.filter(o=>Number(o.invoiceNo)===invoiceNo);
   const ours=matched.some(o=>o.pairRole!=='collaborator'&&
    allowed.some(d=>normalized(d.name)===normalized(o.name)&&
     normalized(d.location)===normalized(o.location)&&digits(d.phone)===digits(o.phone)));
   return {invoiceNo,status:ours?'active':matched.length?'unverified':'absent'};
  });
  return {production:true,complete:true,revision,checks};
 }
 function receiptContext({token,accessCode,receiptToken}={}){
  const invite=access(token,accessCode);
  const proof=unseal(receiptToken,'customer-receipt');
  if(proof.type!=='customer-real-receipt'||proof.inviteId!==invite.id||
     !Number.isSafeInteger(proof.invoiceNo)||proof.invoiceNo<1||
     !Number.isSafeInteger(proof.total)||proof.total<0||
     !validRef(proof.customerRef)||!Number.isSafeInteger(proof.expiresAt)||
     proof.expiresAt<=now()||proof.expiresAt>now()+7*86400000)
   throw error('REAL_RECEIPT_PROOF_INVALID');
  const dest=chosen(invite,proof.customerRef);
  if(dest.name!==proof.name||dest.phone!==proof.phone||
     dest.location!==proof.location)throw error('REAL_RECEIPT_CUSTOMER_MISMATCH');
  return {invoiceNo:proof.invoiceNo,total:proof.total,
   name:dest.name,phone:dest.phone,location:dest.location};
 }
 return Object.freeze({readiness,probeWriteScope,issue,inspectIssuedForOwner,catalogue,quote,confirm,chatContext,receiptContext,history,receiptStatuses});
}
