/*
 * Account Ordering V2 API. Opt-in, isolated from legacy /real and /ctv.
 * No production invoice writes. PostgreSQL is mandatory for any customer state.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {calculateQuote,normalizeCart,validateAddress,validateAdminAddressEdit,validateAdminProfileEdit,isUuid,isSku,DomainError} from './domain.mjs';
import {interpretLegacyOrder} from './legacy-interpret.mjs';
import {proposeV2GeminiCart} from './original-gemini-cart-adapter.mjs';
import {geminiConfigured} from '../free-parser.mjs';
import {answerGeminiProductQuestion,productQuestionEligible} from './gemini-product-assistant.mjs';
import {recognisedCatalogueQuestion,verifiedAvailabilityAnswer,missingV2CatalogueMessage} from './catalogue-dialogue.mjs';
import {readMinhSatori,readOnlyReady} from '../satori-readonly.mjs';
import {monthRange,safeLegacyInvoiceIndex} from './legacy-owner-invoices.mjs';
import {validateCanonicalCatalogue} from './canonical-catalogue.mjs';
import {acceptedSubjects} from './identity-rollout.mjs';
import {inspectV2Storage,createCachedStorageProbe} from './db-readiness.mjs';
import {assertCurrentQuote} from './quote-freshness.mjs';
import {CrmError,registrationSave,registrationRead,adminCustomerList,adminCreateLead,
 adminPatchLead,adminChangeCustomerStatus,adminEditRegisteredCustomer,adminLinkLead} from './customer-backend.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const random=(size=32)=>crypto.randomBytes(size).toString('hex');
const MAX_JSON=24_000;
const STATUS={ok:true,version:'v2',legacyLinksUntouched:true,realInvoicesEnabled:false};
let poolPromise=null,googlePromise=null;
class ApiError extends Error{
 constructor(code,status=400){super(code);this.code=code;this.status=status}
}
const error=(condition,code,status=400)=>{if(!condition)throw new ApiError(code,status)};
const flag=()=>process.env.SATORI_ACCOUNT_V2_ENABLED==='1';
const signupOpen=()=>process.env.SATORI_ACCOUNT_V2_SIGNUP_ENABLED==='1';
const config=()=>({
 enabled:flag(),clientId:process.env.SATORI_ACCOUNT_V2_GOOGLE_CLIENT_ID||'',
 origin:process.env.SATORI_ACCOUNT_V2_ORIGIN||'',
 databaseUrl:process.env.SATORI_ACCOUNT_V2_DATABASE_URL||'',
 ownerGoogleSub:process.env.SATORI_ACCOUNT_V2_OWNER_SUB||'',
 pilotSub:process.env.SATORI_ACCOUNT_V2_PILOT_SUB||''
});
function ready(){
 const cfg=config();
 return !!(cfg.enabled&&cfg.clientId&&cfg.origin.startsWith('https://')&&
  cfg.databaseUrl&&cfg.ownerGoogleSub&&cfg.pilotSub&&
  acceptedSubjects().ownerReady);
}
function send(res,code,data,headers={}){
 res.writeHead(code,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','x-frame-options':'DENY',
  ...headers});
 res.end(JSON.stringify(data));
}
export async function json(req){
 // Chunk boundaries are arbitrary, including halfway through a Vietnamese UTF-8
 // code point. Decode ONCE after enforcing a byte limit, never per chunk.
 const chunks=[];
 let length=0;
 for await(const chunk of req){
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
  length+=bytes.length;
  if(length>MAX_JSON)throw new ApiError('REQUEST_TOO_LARGE',413);
  chunks.push(bytes);
 }
 try{
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,length));
  const val=JSON.parse(raw);
  error(val&&typeof val==='object'&&!Array.isArray(val),'JSON_OBJECT_REQUIRED');
  return val;
 }catch(e){
  if(e instanceof ApiError)throw e;
  throw new ApiError('INVALID_JSON');
 }
}
function cookies(req){
 const out={};
 for(const part of String(req.headers.cookie||'').split(';')){
  const eq=part.indexOf('=');
  if(eq>0)out[part.slice(0,eq).trim()]=part.slice(eq+1).trim();
 }
 return out;
}
function secureCookies(token,csrf){
 const secure='; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800';
 return ['satori_v2_session='+token+secure,
  'satori_v2_csrf='+csrf+'; Secure; SameSite=Lax; Path=/; Max-Age=604800'];
}
function clearCookies(){
 return ['satori_v2_session=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
  'satori_v2_csrf=; Secure; SameSite=Lax; Path=/; Max-Age=0'];
}
function enforceOrigin(req){
 error(req.headers.origin===config().origin,'ORIGIN_FORBIDDEN',403);
}
async function db(){
 if(!poolPromise)poolPromise=import('pg').then(({default:pg})=>{
  return new pg.Pool({connectionString:config().databaseUrl,max:5,
   connectionTimeoutMillis:5000,idleTimeoutMillis:20000,
   ssl:process.env.SATORI_ACCOUNT_V2_PG_SSL==='1'?{rejectUnauthorized:true}:undefined});
 }).catch(e=>{poolPromise=null;throw e});
 return poolPromise;
}
// The read-only connection/schema check is cached to limit public requests.
const storageReadiness=createCachedStorageProbe(async()=>{
 const pool=await db();
 return inspectV2Storage(pool);
});
async function google(){
 if(!googlePromise)googlePromise=import('google-auth-library')
  .then(({OAuth2Client})=>new OAuth2Client(config().clientId))
  .catch(e=>{googlePromise=null;throw e});
 return googlePromise;
}
async function auth(req,pool){
 const raw=cookies(req).satori_v2_session;
 error(typeof raw==='string'&&/^[a-f0-9]{64}$/.test(raw),'LOGIN_REQUIRED',401);
 const r=await pool.query(
  'SELECT a.id,a.google_sub,a.email,a.display_name,a.access_status,s.csrf_hash FROM satori_v2_sessions s '+
  'JOIN satori_v2_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()',
  [sha(raw)]);
 error(r.rows.length===1,'SESSION_EXPIRED',401);
 const actor=r.rows[0];
 // Signup accepts immutable Google identities only when explicitly enabled.
 if(!signupOpen())error(acceptedSubjects().allows(actor.google_sub),'ACCOUNT_NOT_APPROVED',403);
 error(actor.access_status!=='REMOVED'&&actor.access_status!=='SUSPENDED',
  'ACCOUNT_ACCESS_DISABLED',403);
 if(req.method!=='GET'&&req.method!=='HEAD'){
  enforceOrigin(req);
  const csrf=String(req.headers['x-satori-csrf']||'');
  const provided=cookies(req).satori_v2_csrf;
  error(csrf&&csrf===provided&&sha(csrf)===actor.csrf_hash,'CSRF_FORBIDDEN',403);
 }
 return actor;
}
async function profileFor(pool,actor,profileId){
 error(isUuid(profileId),'PROFILE_REQUIRED');
 const r=await pool.query('SELECT id,account_id AS "accountId",type,display_name AS "name" '+
  'FROM satori_v2_profiles WHERE id=$1 AND account_id=$2',[profileId,actor.id]);
 error(r.rows.length===1,'PROFILE_FORBIDDEN',403);
 return r.rows[0];
}
function publicUser(actor){return {id:actor.id,email:actor.email,name:actor.display_name,
 accessStatus:actor.access_status,isAdmin:actor.google_sub===config().ownerGoogleSub}}
async function login(req,res,pool){
 enforceOrigin(req);
 const input=await json(req);
 error(typeof input.credential==='string'&&input.credential.length<5000&&input.credential.length>100,'ID_TOKEN_REQUIRED');
 const client=await google();
 let payload;
 try{
  const ticket=await client.verifyIdToken({idToken:input.credential,audience:config().clientId});
  payload=ticket.getPayload();
 }catch{throw new ApiError('GOOGLE_TOKEN_INVALID',401)}
 error(payload&&payload.email_verified===true&&typeof payload.sub==='string','GOOGLE_ACCOUNT_UNVERIFIED',401);
 error(signupOpen()||acceptedSubjects().allows(payload.sub),'ACCOUNT_NOT_APPROVED',403);
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const isOwner=payload.sub===config().ownerGoogleSub;
  const account=await conn.query('INSERT INTO satori_v2_accounts(google_sub,email,display_name,access_status) VALUES($1,$2,$3,$4) '+
   'ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email,updated_at=now() '+
   'RETURNING id,email,display_name,access_status',
    [payload.sub,payload.email||'',payload.name||'',isOwner?'ACTIVE':'PENDING']);
  error(isOwner||!['REMOVED','SUSPENDED'].includes(account.rows[0].access_status),
   'ACCOUNT_ACCESS_DISABLED',403);
  const id=account.rows[0].id;
  const exists=await conn.query('SELECT id FROM satori_v2_profiles WHERE account_id=$1 LIMIT 1',[id]);
  if(!exists.rows.length)await conn.query('INSERT INTO satori_v2_profiles(account_id,type,display_name) VALUES($1,$2,$3)',
   [id,'retail',payload.name||'Khách hàng']);
  const token=random(),csrf=random(24);
  await conn.query('INSERT INTO satori_v2_sessions(token_hash,csrf_hash,account_id,expires_at) VALUES($1,$2,$3,now()+interval \'7 days\')',
   [sha(token),sha(csrf),id]);
  await conn.query('COMMIT');
  send(res,200,{ok:true,accountId:id,pilot:true},{'set-cookie':secureCookies(token,csrf)});
 }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e}finally{conn.release()}
}
function owner(actor){error(actor.google_sub===config().ownerGoogleSub,'ADMIN_REQUIRED',403)}
async function adminPolicy(pool,actor,input){
 owner(actor);
 error(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
 error(isUuid(input.profileId),'PROFILE_REQUIRED');
 error(input.addressId==null||isUuid(input.addressId),'ADDRESS_INVALID');
 error(input.productCode==null||isSku(input.productCode),'SKU_INVALID');
 error(Number.isInteger(input.discountBps)&&input.discountBps>=0&&input.discountBps<=10000,'DISCOUNT_INVALID');
 const mode=input.invoiceMode||'single';
 error(['single','pair'].includes(mode),'INVOICE_MODE_INVALID');
 error(mode!=='pair'||Number.isInteger(input.collaboratorBps)&&input.collaboratorBps>=0&&input.collaboratorBps<=10000,
  'COLLABORATOR_DISCOUNT_INVALID');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const profile=await client.query('SELECT id,type FROM satori_v2_profiles WHERE id=$1 FOR UPDATE',[input.profileId]);
  error(profile.rows.length===1,'PROFILE_NOT_FOUND',404);
  error(mode!=='pair'||profile.rows[0].type==='collaborator','PAIR_NOT_AUTHORIZED');
  if(input.addressId){
   const addr=await client.query('SELECT id FROM satori_v2_addresses WHERE id=$1 AND profile_id=$2',
    [input.addressId,input.profileId]);
   error(addr.rows.length===1,'ADDRESS_FORBIDDEN',403);
  }
  // Replacing a policy closes prior approved revisions for the EXACT scope.
  // Historical quotes still store immutable price/policy snapshots.
  const version=await client.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM satori_v2_policies '+
   'WHERE profile_id=$1 AND address_id IS NOT DISTINCT FROM $2 AND product_code IS NOT DISTINCT FROM $3',
   [input.profileId,input.addressId||null,input.productCode||null]);
  await client.query('UPDATE satori_v2_policies SET enabled=false,revision=revision+1 '+
   'WHERE profile_id=$1 AND address_id IS NOT DISTINCT FROM $2 '+
   'AND product_code IS NOT DISTINCT FROM $3 AND enabled=true',
   [input.profileId,input.addressId||null,input.productCode||null]);
  const policy=await client.query('INSERT INTO satori_v2_policies '+
   '(profile_id,address_id,product_code,discount_bps,collaborator_bps,invoice_mode,version,approved_by) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,version',
   [input.profileId,input.addressId||null,input.productCode||null,input.discountBps,
    mode==='pair'?input.collaboratorBps:null,mode,version.rows[0].version,actor.google_sub]);
  await client.query('INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
   'VALUES($1,$2,$3,$4,$5)',[actor.id,'owner','POLICY_APPROVED',policy.rows[0].id,
    JSON.stringify({profileId:input.profileId,addressId:input.addressId||null,productCode:input.productCode||null,
     discountBps:input.discountBps,collaboratorBps:mode==='pair'?input.collaboratorBps:null,mode})]);
  await client.query('COMMIT');
  return policy.rows[0];
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}
/** Canonical policy-approved read used without a write for cart preview. */
async function pricedCart(pool,actor,input){
 const profile=await profileFor(pool,actor,input.profileId);
 error(isUuid(input.addressId),'ADDRESS_REQUIRED');
 const addressRow=await pool.query('SELECT id,profile_id AS "profileId",active,label,recipient_name AS "recipientName", '+
  'recipient_phone AS "recipientPhone",address FROM satori_v2_addresses '+
  'WHERE id=$1 AND profile_id=$2',[input.addressId,profile.id]);
 error(addressRow.rows.length===1,'ADDRESS_FORBIDDEN',403);
 const cartRow=await pool.query('SELECT lines,revision FROM satori_v2_carts WHERE account_id=$1 AND profile_id=$2',
  [actor.id,profile.id]);
 error(cartRow.rows.length===1,'CART_EMPTY');
 const cat=await pool.query('SELECT code,name,unit,list_price AS "listPrice",revision,active FROM satori_v2_catalogue');
 error(cat.rows.length>0&&cat.rows.every(p=>p.revision===cat.rows[0].revision),'CATALOGUE_NOT_READY',503);
 const policies=await pool.query('SELECT id,profile_id AS "profileId",address_id AS "addressId", '+
  'product_code AS "productCode", discount_bps AS "discountBps",collaborator_bps AS "collaboratorBps", '+
  'invoice_mode AS "invoiceMode",enabled,version,valid_from AS "validFrom",valid_until AS "validUntil" '+
  'FROM satori_v2_policies WHERE profile_id=$1 AND enabled=true',[profile.id]);
 const priced=calculateQuote({accountId:actor.id,profile,address:addressRow.rows[0],cart:cartRow.rows[0].lines,
  catalogue:cat.rows.map(x=>({...x,listPrice:Number(x.listPrice)})),policies:policies.rows,
  catalogueRevision:cat.rows[0].revision,vatBps:0,shippingVnd:0});
 return {priced,cartRevision:cartRow.rows[0].revision,catalogueRevision:cat.rows[0].revision};
}
function customerPricing(data){
 // The CTV internal reference is not a customer-facing sale price.
 const {internalReference,...shown}=data.priced;
 return {...shown,items:shown.items.map(({internalUnitPrice,...line})=>line),
  cartRevision:data.cartRevision,chargesConfigured:false};
}
async function quote(pool,actor,input){
 const {priced,cartRevision,catalogueRevision}=await pricedCart(pool,actor,input);
 const r=await pool.query('INSERT INTO satori_v2_quotes(account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,expires_at) '+
  'VALUES($1,$2,$3,$4,$5,$6,now()+interval \'10 minutes\') RETURNING id,expires_at',
  [actor.id,priced.profileId,priced.addressId,JSON.stringify(priced),cartRevision,catalogueRevision]);
 return {quoteId:r.rows[0].id,expiresAt:r.rows[0].expires_at,...priced,
  note:'Báo giá kiểm thử. Chưa tạo hóa đơn thật hoặc ghi công nợ.'};
}
/**
 * Explicit delivery selection is an order-flow prerequisite, not permission
 * inferred from the first saved address. Scope both profile and address to the
 * authenticated account; disabled or cross-tenant addresses fail closed.
 */
export async function assertSelectedDelivery(pool,actor,input){
 error(isUuid(input?.profileId)&&isUuid(input?.addressId),'DELIVERY_ADDRESS_REQUIRED',409);
 const r=await pool.query(
  'SELECT a.id FROM satori_v2_addresses a '+
  'JOIN satori_v2_profiles p ON p.id=a.profile_id '+
  'WHERE a.id=$1 AND a.profile_id=$2 AND p.account_id=$3 AND a.active=true',
  [input.addressId,input.profileId,actor.id]);
 error(r.rows.length===1,'DELIVERY_ADDRESS_REQUIRED',409);
 return true;
}
export async function interpret(pool,input){
 error(typeof input.message==='string'&&input.message.trim().length>=2&&input.message.length<=500,'MESSAGE_INVALID');
 // Answer strict product-existence questions from CURRENT active V2 catalogue,
 // not the order parser and not from a model's invented commercial facts.
 const question=recognisedCatalogueQuestion(input.message);
 if(question){
  const r=await pool.query('SELECT code,name,unit FROM satori_v2_catalogue WHERE active=true');
  const verified=r.rows.some(product=>product.code===question.code);
  return {needsClarification:true,provider:'verified-v2-catalogue',
   source:'verified-v2-catalogue-faq',geminiConfigured:geminiConfigured(),
   // A verified SKU allows a short, scoped follow-up such as "5 thùng".
   // Never offer this context if the product is absent from active V2.
   availableProductCode:verified?question.code:null,
   message:verifiedAvailabilityAnswer(question,r.rows)};
 }
 // Reuse the original Vietnamese parser. Every proposed SKU must subsequently
 // exist in the active V2 catalogue; never auto-create or substitute products.
 const result=await interpretLegacyOrder(input.message);
 const fallback={...result,provider:/gemini/.test(result?.source||'')?'gemini':'satori-rules',
  geminiConfigured:geminiConfigured()};
 if(Array.isArray(result?.suggestedItems)&&result.suggestedItems.length){
  const r=await pool.query('SELECT code,name,unit FROM satori_v2_catalogue WHERE active=true');
  const missing=missingV2CatalogueMessage(result.suggestedItems,r.rows);
  if(missing)return {needsClarification:true,provider:'verified-v2-catalogue',
   source:'v2-catalogue-missing-sku',geminiConfigured:geminiConfigured(),
   message:missing};
  return fallback;
 }
 // Existing model assistant handles non-order public questions, scoped to
 // verified ACTIVE products and a sanitized message. Fallback stays safe.
 if(geminiConfigured()&&productQuestionEligible(input.message)){
  const r=await pool.query('SELECT code,name,unit,active FROM satori_v2_catalogue WHERE active=true');
  const help=await answerGeminiProductQuestion(input.message,r.rows);
  if(help)return {...help,geminiConfigured:true};
 }
 return fallback;
}
export async function handleAccountV2(req,res,pathname){
 const page=pathname==='/app-v2'||pathname==='/app-v2/';
 const ownerPage=pathname==='/owner-v2'||pathname==='/owner-v2/';
 const api=pathname.startsWith('/api/v2/');
 if(!page&&!ownerPage&&!api)return false;
 try{
  if(page||ownerPage){
   const html=fs.readFileSync(path.join(HERE,ownerPage?'owner-catalogue.html':'app.html'),'utf8');
   res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'x-frame-options':'DENY','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; style-src 'unsafe-inline' https://accounts.google.com/gsi/style; script-src 'unsafe-inline' https://accounts.google.com/gsi/client; connect-src 'self' https://accounts.google.com/gsi/; img-src 'self' data:; frame-src https://accounts.google.com/gsi/; frame-ancestors 'none'; form-action 'none'; base-uri 'none'"});
   res.end(html);return true;
  }
  if(pathname==='/api/v2/storage-readiness'&&req.method==='GET'){
   const configured=!!config().databaseUrl;
   const result=configured?await storageReadiness():
    {connected:false,schemaReady:false,tableCount:0};
   send(res,200,{ok:true,service:'minh-satori-account-v2',
    configured,...result,realInvoicesEnabled:false});
   return true;
  }
  if(pathname==='/api/v2/status'&&req.method==='GET'){
   send(res,200,{...STATUS,enabled:ready(),pilotOnly:!acceptedSubjects().customerRolloutReady,
    customerRolloutEnabled:ready()&&(signupOpen()||acceptedSubjects().customerRolloutReady),
    signupEnabled:ready()&&signupOpen(),
    testOrdersEnabled:ready()&&process.env.SATORI_ACCOUNT_V2_TEST_ORDERS_ENABLED==='1',
     geminiConfigured:geminiConfigured(),geminiModel:geminiConfigured()?'gemini-3.5-flash-lite':null,
    googleClientId:flag()?config().clientId:null,durableStorageReady:!!config().databaseUrl});
   return true;
  }
  error(ready(),'ACCOUNT_V2_DISABLED',503);
  const pool=await db();
  if(pathname==='/api/v2/auth/google'&&req.method==='POST'){
   await login(req,res,pool);return true;
  }
  const actor=await auth(req,pool);
  const isOwner=actor.google_sub===config().ownerGoogleSub;
  const isRegistrationRoute=(pathname==='/api/v2/register'&&
   (req.method==='GET'||req.method==='POST'))||
   (pathname==='/api/v2/me'&&req.method==='GET')||
   (pathname==='/api/v2/logout'&&req.method==='POST');
  // Customers without owner approval can only complete their registration.
  error(isOwner||actor.access_status==='ACTIVE'||isRegistrationRoute,
   'CUSTOMER_PENDING_ADMIN_APPROVAL',403);
  if(pathname==='/api/v2/register'&&req.method==='GET'){
   send(res,200,await registrationRead(pool,actor));return true;
  }
  if(pathname==='/api/v2/register'&&req.method==='POST'){
   send(res,200,await registrationSave(pool,actor,await json(req)));return true;
  }
  if(pathname==='/api/v2/admin/customers'&&req.method==='GET'){
   owner(actor);send(res,200,await adminCustomerList(pool));return true;
  }
  if(pathname==='/api/v2/admin/customers'&&req.method==='POST'){
   owner(actor);send(res,201,await adminCreateLead(pool,actor.id,await json(req)));return true;
  }
  if(pathname==='/api/v2/admin/customers'&&req.method==='PATCH'){
   owner(actor);send(res,200,await adminChangeCustomerStatus(pool,actor,await json(req)));return true;
  }
  if(pathname==='/api/v2/admin/customers/details'&&req.method==='PATCH'){
   owner(actor);send(res,200,await adminEditRegisteredCustomer(pool,actor,await json(req)));return true;
  }
  if(pathname==='/api/v2/admin/customer-leads'&&req.method==='PATCH'){
   owner(actor);send(res,200,await adminPatchLead(pool,actor.id,await json(req)));return true;
  }
  if(pathname==='/api/v2/admin/customer-leads/link'&&req.method==='POST'){
   owner(actor);send(res,200,await adminLinkLead(pool,actor,await json(req)));return true;
  }
  if(pathname==='/api/v2/me'&&req.method==='GET'){
   const profiles=await pool.query('SELECT id,type,display_name AS name,phone FROM satori_v2_profiles WHERE account_id=$1 ORDER BY created_at',
    [actor.id]);
   const addresses=await pool.query('SELECT a.id,a.profile_id AS "profileId",a.label, '+
    'a.recipient_name AS "recipientName",a.recipient_phone AS "recipientPhone",a.address,a.active, '+
    'history.last_ordered_at AS "lastOrderedAt" FROM satori_v2_addresses a '+
    'JOIN satori_v2_profiles p ON a.profile_id=p.id '+
    'LEFT JOIN LATERAL (SELECT MAX(q.created_at) AS last_ordered_at '+
    'FROM satori_v2_quotes q JOIN satori_v2_order_requests r ON r.quote_id=q.id '+
    "AND r.state='COMMITTED' AND r.account_id=p.account_id "+
    'WHERE q.address_id=a.id AND q.profile_id=a.profile_id AND q.account_id=p.account_id) history ON true '+
    'WHERE p.account_id=$1 ORDER BY history.last_ordered_at DESC NULLS LAST,a.created_at',[actor.id]);
   send(res,200,{ok:true,account:publicUser(actor),profiles:profiles.rows,addresses:addresses.rows});return true;
  }
  if(pathname==='/api/v2/logout'&&req.method==='POST'){
   await pool.query('DELETE FROM satori_v2_sessions WHERE token_hash=$1',[sha(cookies(req).satori_v2_session)]);
   send(res,200,{ok:true},{'set-cookie':clearCookies()});return true;
  }
  if(pathname==='/api/v2/addresses'&&req.method==='POST'){
   const input=await json(req),profile=await profileFor(pool,actor,input.profileId);
   const a=validateAddress(input);
   const r=await pool.query('INSERT INTO satori_v2_addresses(profile_id,label,recipient_name,recipient_phone,address) '+
    'VALUES($1,$2,$3,$4,$5) RETURNING id',[profile.id,a.label,a.recipientName,a.recipientPhone,a.address]);
   send(res,201,{ok:true,id:r.rows[0].id});return true;
  }
  if(pathname==='/api/v2/addresses'&&req.method==='PATCH'){
   // Account-scoped revision CAS: customers can edit only their own addresses.
   // Address ownership is checked INSIDE the UPDATE. Never trust profileId alone.
   const input=validateAdminAddressEdit(await json(req));
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const updated=await client.query(
     'UPDATE satori_v2_addresses AS a SET label=$3,recipient_name=$4, '+
     'recipient_phone=$5,address=$6,active=$7,revision=a.revision+1,updated_at=now() '+
     'FROM satori_v2_profiles AS p WHERE a.id=$1 AND a.profile_id=$2 '+
     'AND p.id=a.profile_id AND p.account_id=$9 AND a.revision=$8 '+
     'RETURNING a.id,a.revision,a.active',
     [input.addressId,input.profileId,input.label,input.recipientName,
      input.recipientPhone,input.address,input.active,input.expectedRevision,actor.id]);
    if(updated.rows.length!==1){
     const access=await client.query(
      'SELECT a.revision FROM satori_v2_addresses a '+
      'JOIN satori_v2_profiles p ON p.id=a.profile_id '+
      'WHERE a.id=$1 AND a.profile_id=$2 AND p.account_id=$3',
      [input.addressId,input.profileId,actor.id]);
     error(access.rows.length===1,'ADDRESS_FORBIDDEN',403);
     throw new ApiError('ADDRESS_REVISION_CONFLICT',409);
    }
    await client.query(
     'INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
     'VALUES($1,$2,$3,$4,$5)',
     [actor.id,'account','DELIVERY_ADDRESS_EDITED',input.addressId,
      JSON.stringify({previousRevision:input.expectedRevision,newRevision:updated.rows[0].revision,
       active:input.active})]);
    await client.query('COMMIT');
    send(res,200,{ok:true,address:updated.rows[0]});return true;
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
   finally{client.release()}
  }
  if(pathname==='/api/v2/cart'&&req.method==='GET'){
   const profile=await profileFor(pool,actor,new URL(req.url,'http://local').searchParams.get('profileId'));
   const r=await pool.query('SELECT lines,revision FROM satori_v2_carts WHERE account_id=$1 AND profile_id=$2',
    [actor.id,profile.id]);
   send(res,200,{ok:true,lines:r.rows[0]?.lines||[],revision:r.rows[0]?.revision||0});return true;
  }
  if(pathname==='/api/v2/cart'&&req.method==='PUT'){
   const input=await json(req),profile=await profileFor(pool,actor,input.profileId);
   error(Array.isArray(input.lines),'CART_INVALID');
   error(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0&&
    input.expectedRevision<=1_000_000_000,'CART_REVISION_REQUIRED',409);
   const lines=input.lines.length?normalizeCart(input.lines):[];
   // Clearing an existing cart is allowed, but adding/ordering requires a
   // deliberately selected live delivery point in the same account.
   if(lines.length)await assertSelectedDelivery(pool,actor,input);
   let r;
   if(input.expectedRevision===0){
    r=await pool.query('INSERT INTO satori_v2_carts(account_id,profile_id,lines) VALUES($1,$2,$3) '+
     'ON CONFLICT(account_id,profile_id) DO NOTHING RETURNING revision',
     [actor.id,profile.id,JSON.stringify(lines)]);
   }else{
    r=await pool.query('UPDATE satori_v2_carts SET lines=$3,revision=revision+1,updated_at=now() '+
     'WHERE account_id=$1 AND profile_id=$2 AND revision=$4 RETURNING revision',
     [actor.id,profile.id,JSON.stringify(lines),input.expectedRevision]);
   }
   error(r.rows.length===1,'CART_REVISION_CONFLICT',409);
   send(res,200,{ok:true,lines,revision:r.rows[0].revision});return true;
  }
  if(pathname==='/api/v2/admin/original-invoices'&&req.method==='GET'){
   // Original ledger is owner-only. Never join by ambiguous name or phone.
   owner(actor);
   const month=new URL(req.url,'http://local').searchParams.get('month');
   let window;
   try{window=monthRange(month)}
   catch{throw new ApiError('INVALID_INVOICE_MONTH',400)}
   if(!readOnlyReady()){
    send(res,200,{ok:true,configured:false,source:'signed-original-satori-ledger',
     revision:null,totalMatches:0,truncated:false,orders:[]});return true;
   }
   const result=await readMinhSatori('orders.list',{...window,limit:100});
   send(res,200,{ok:true,configured:true,...safeLegacyInvoiceIndex(result)});return true;
  }
  if(pathname==='/api/v2/orders'&&req.method==='GET'){
   // No broad legacy-ledger search. Only independently authored V2 orders
   // whose quote AND order request belong to this authenticated Google account.
   const data=await pool.query(
    'SELECT r.id,r.request_id AS "requestId",r.state, '+
    'CASE WHEN r.state=$2 THEN r.ledger_invoice_no ELSE NULL END AS "invoiceNo", '+
    'q.created_at AS "orderedAt",q.payload->>\'invoiceMode\' AS "invoiceMode", '+
    'q.payload->>\'totalVnd\' AS "totalVnd",q.payload->>\'currency\' AS currency '+
    'FROM satori_v2_order_requests r JOIN satori_v2_quotes q ON q.id=r.quote_id '+
    'WHERE r.account_id=$1 AND q.account_id=$1 '+
    'ORDER BY q.created_at DESC LIMIT 50',[actor.id,'COMMITTED']);
   send(res,200,{ok:true,orders:data.rows.map(x=>({...x,verified:x.state==='COMMITTED'&&
    Number.isSafeInteger(x.invoiceNo)&&x.invoiceNo>0}))});return true;
  }
  if(pathname==='/api/v2/admin/catalogue/readiness'&&req.method==='GET'){
   // Owner-only, aggregate-only diagnostic. Never exposes HMAC credentials,
   // customer records, financial records, or a read gateway endpoint.
   owner(actor);
   const r=await pool.query(
    "SELECT COUNT(*) FILTER (WHERE active=true)::int AS active_count, "+
    "COALESCE(MAX(revision),0)::int AS revision, "+
    "COUNT(*) FILTER (WHERE active=true AND code='TP-00003')::int AS satori500, "+
    "COUNT(*) FILTER (WHERE active=true AND code='TP-00058')::int AS oihong "+
    "FROM satori_v2_catalogue");
   const x=r.rows[0];
   send(res,200,{ok:true,activeCount:Number(x.active_count),
    revision:Number(x.revision),satori500Active:Number(x.satori500)>0,
    oiHongActive:Number(x.oihong)>0,readTransportConfigured:readOnlyReady()});
   return true;
  }
  if(pathname==='/api/v2/catalogue'&&req.method==='GET'){
   const r=await pool.query('SELECT code,name,unit,list_price AS "listPrice",revision FROM satori_v2_catalogue '+
    'WHERE active=true ORDER BY code LIMIT 200');
   send(res,200,{ok:true,items:r.rows.map(x=>({...x,listPrice:Number(x.listPrice)})),
    catalogueReady:r.rows.length>0});return true;
  }
  if(pathname==='/api/v2/interpret'&&req.method==='POST'){
   const input=await json(req);
   await assertSelectedDelivery(pool,actor,input);
   const result=await interpret(pool,input);
   if(!Array.isArray(result.suggestedItems)||!result.suggestedItems.length){
    send(res,200,{ok:true,...result});return true;
   }
   // Reuse old Gemini's add/set/replace semantics. All state stays in the
   // authenticated V2 cart, never in a legacy link or browser-only draft.
   // The browser still performs an explicit, revision-checked /api/v2/cart PUT.
   const [cartRow,productRows]=await Promise.all([
    pool.query('SELECT lines,revision FROM satori_v2_carts WHERE account_id=$1 AND profile_id=$2',
     [actor.id,input.profileId]),
    pool.query('SELECT code FROM satori_v2_catalogue WHERE active=true')
   ]);
   error(cartRow.rows.length<=1,'CART_SOURCE_AMBIGUOUS',503);
   const existing=cartRow.rows[0];
   const current=existing?.lines||[];
   const activeCodes=new Set(productRows.rows.map(x=>x.code));
   const proposedCart=proposeV2GeminiCart(input.message,current,result.suggestedItems,activeCodes);
   send(res,200,{ok:true,...result,proposedCart,
    baseCartRevision:Number(existing?.revision||0)});return true;
  }
  if(pathname==='/api/v2/cart-pricing'&&req.method==='GET'){
   // Authenticated, account-owned, active delivery; no invoice/quote INSERT.
   const query=new URL(req.url,'http://local').searchParams;
   const priced=await pricedCart(pool,actor,{
    profileId:query.get('profileId'),addressId:query.get('addressId')});
   send(res,200,{ok:true,...customerPricing(priced)});
   return true;
  }
  if(pathname==='/api/v2/quote'&&req.method==='POST'){
   const result=await quote(pool,actor,await json(req));send(res,200,{ok:true,...result});return true;
  }
  if(pathname==='/api/v2/test-orders'&&req.method==='POST'){
   // An authenticated, isolated TEST request persisted in new PostgreSQL only.
   // It never sends anything to Apps Script, PDF generation or the real ledger.
   error(process.env.SATORI_ACCOUNT_V2_TEST_ORDERS_ENABLED==='1','TEST_ORDERS_DISABLED',503);
   const input=await json(req);
   error(isUuid(input.quoteId)&&isUuid(input.requestId),'TEST_ORDER_ID_REQUIRED');
   error(input.confirmedTest===true,'EXPLICIT_TEST_CONFIRMATION_REQUIRED',403);
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const quote=await client.query(
     'SELECT id,account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,expires_at '+
     'FROM satori_v2_quotes WHERE id=$1 AND account_id=$2 FOR UPDATE',[input.quoteId,actor.id]);
    error(quote.rows.length===1,'QUOTE_FORBIDDEN',403);
    const q=quote.rows[0];
    const prior=await client.query('SELECT id,request_id AS "requestId",quote_id AS "quoteId",state '+
     'FROM satori_v2_order_requests WHERE account_id=$1 AND (request_id=$2 OR quote_id=$3) FOR UPDATE',
     [actor.id,input.requestId,q.id]);
    if(prior.rows.length){
     error(prior.rows.length===1&&prior.rows[0].quoteId===q.id&&
      prior.rows[0].requestId===input.requestId,'TEST_ORDER_CONFLICT',409);
     await client.query('COMMIT');
     send(res,200,{ok:true,testOnly:true,noInvoice:true,alreadySubmitted:true,
      orderId:prior.rows[0].id,state:prior.rows[0].state});return true;
    }
    error(new Date(q.expires_at).getTime()>Date.now(),'QUOTE_EXPIRED',409);
    // Serialize checkout with catalogue refresh, and revalidate all approvals.
    await client.query('SELECT pg_advisory_xact_lock_shared($1,$2)',[20261025,2]);
    // Auth happened before this transaction. Serialize with Admin suspension,
    // removal and discount approval, which lock account before profile.
    const checkedAccount=await client.query(
     'SELECT access_status FROM satori_v2_accounts WHERE id=$1 FOR SHARE',[actor.id]);
    error(checkedAccount.rows[0]?.access_status==='ACTIVE','ACCOUNT_ACCESS_DISABLED',403);
    const checkedProfile=await client.query(
     'SELECT id,account_id AS "accountId",type FROM satori_v2_profiles '+
     'WHERE id=$1 AND account_id=$2 FOR SHARE',[q.profile_id,actor.id]);
    error(checkedProfile.rows.length===1,'QUOTE_PROFILE_STALE',409);
    const checkedAddress=await client.query(
     'SELECT id,profile_id AS "profileId",active,label,'+
     'recipient_name AS "recipientName",recipient_phone AS "recipientPhone",address '+
     'FROM satori_v2_addresses WHERE id=$1 AND profile_id=$2 FOR SHARE',
     [q.address_id,q.profile_id]);
    error(checkedAddress.rows.length===1,'QUOTE_ADDRESS_STALE',409);
    const latest=await client.query('SELECT lines,revision FROM satori_v2_carts '+
     'WHERE account_id=$1 AND profile_id=$2 FOR UPDATE',[actor.id,q.profile_id]);
    error(latest.rows.length===1&&latest.rows[0].revision===q.cart_revision,
     'QUOTE_CART_STALE',409);
    const cat=await client.query(
     'SELECT code,name,unit,list_price AS "listPrice",revision,active '+
     'FROM satori_v2_catalogue WHERE active=true ORDER BY code');
    error(cat.rows.length>0&&cat.rows.every(p=>p.revision===q.catalogue_revision),
     'QUOTE_CATALOGUE_STALE',409);
    const approvedPolicies=await client.query(
     'SELECT id,profile_id AS "profileId",address_id AS "addressId",'+
     'product_code AS "productCode",discount_bps AS "discountBps",'+
     'collaborator_bps AS "collaboratorBps",invoice_mode AS "invoiceMode",'+
     'enabled,version,valid_from AS "validFrom",valid_until AS "validUntil" '+
     'FROM satori_v2_policies WHERE profile_id=$1 AND enabled=true',
     [q.profile_id]);
    assertCurrentQuote({
     snapshot:q.payload,accountId:actor.id,profile:checkedProfile.rows[0],
     address:checkedAddress.rows[0],cart:latest.rows[0].lines,
     catalogue:cat.rows.map(p=>({...p,listPrice:Number(p.listPrice)})),
     policies:approvedPolicies.rows,catalogueRevision:q.catalogue_revision
    });
    const recorded=await client.query(
     'INSERT INTO satori_v2_order_requests(quote_id,account_id,request_id,state) '+
     "VALUES($1,$2,$3,'PENDING_INTEGRATION') ON CONFLICT DO NOTHING "+
     'RETURNING id,state',[q.id,actor.id,input.requestId]);
    if(!recorded.rows.length){
     const existing=await client.query('SELECT id,request_id AS "requestId",quote_id AS "quoteId",state '+
      'FROM satori_v2_order_requests WHERE account_id=$1 AND (request_id=$2 OR quote_id=$3)',
      [actor.id,input.requestId,q.id]);
     error(existing.rows.length===1&&existing.rows[0].quoteId===q.id&&
      existing.rows[0].requestId===input.requestId,'TEST_ORDER_CONFLICT',409);
     await client.query('COMMIT');
     send(res,200,{ok:true,testOnly:true,noInvoice:true,alreadySubmitted:true,
      orderId:existing.rows[0].id,state:existing.rows[0].state});return true;
    }
    await client.query(
     'INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
     'VALUES($1,$2,$3,$4,$5)',[actor.id,'account','V2_TEST_ORDER_ONLY',
      recorded.rows[0].id,JSON.stringify({quoteId:q.id,cartRevision:q.cart_revision,
       catalogueRevision:q.catalogue_revision,noLedgerWrite:true})]);
    await client.query('COMMIT');
    send(res,201,{ok:true,testOnly:true,noInvoice:true,orderId:recorded.rows[0].id,
     state:'PENDING_INTEGRATION',alreadySubmitted:false});return true;
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
   finally{client.release()}
  }
  if(pathname==='/api/v2/confirm'&&req.method==='POST'){
   // Do not accept a pseudo-order that never reached the Satori ledger.
   send(res,503,{ok:false,error:'REAL_CHECKOUT_GATE_NOT_VERIFIED',
    message:'Hệ thống mới đang kiểm thử. Chưa gửi đơn thật; giỏ hàng vẫn được lưu.'});return true;
  }
  if(pathname==='/api/v2/admin/profiles'&&req.method==='POST'){
   owner(actor);const input=await json(req);
   error(isUuid(input.accountId)&&['retail','agency','collaborator'].includes(input.type),'PROFILE_INVALID');
   error(typeof input.name==='string'&&input.name.trim().length>=2&&input.name.length<=120,'NAME_INVALID');
   const r=await pool.query('INSERT INTO satori_v2_profiles(account_id,type,display_name,phone) '+
    'VALUES($1,$2,$3,$4) RETURNING id',[input.accountId,input.type,input.name.trim(),
     String(input.phone||'').slice(0,30)]);
   send(res,201,{ok:true,profileId:r.rows[0].id});return true;
  }
  if(pathname==='/api/v2/admin/profiles'&&req.method==='PATCH'){
   owner(actor);
   const input=validateAdminProfileEdit(await json(req));
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const saved=await client.query(
     'UPDATE satori_v2_profiles SET display_name=$2,phone=$3,revision=revision+1 '+
     'WHERE id=$1 AND revision=$4 RETURNING id,revision',
     [input.profileId,input.name,input.phone,input.expectedRevision]);
    if(saved.rows.length!==1){
     const exists=await client.query('SELECT id FROM satori_v2_profiles WHERE id=$1',[input.profileId]);
     error(exists.rows.length===1,'PROFILE_NOT_FOUND',404);
     throw new ApiError('PROFILE_REVISION_CONFLICT',409);
    }
    await client.query(
     'INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
     'VALUES($1,$2,$3,$4,$5)',
     [actor.id,'owner','PROFILE_EDITED',input.profileId,JSON.stringify({
      previousRevision:input.expectedRevision,newRevision:saved.rows[0].revision
     })]);
    await client.query('COMMIT');
    send(res,200,{ok:true,profile:saved.rows[0]});return true;
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
   finally{client.release()}
  }
  if(pathname==='/api/v2/admin/policies'&&req.method==='POST'){
   const r=await adminPolicy(pool,actor,await json(req));
   send(res,201,{ok:true,policy:r});return true;
  }
  if(pathname==='/api/v2/admin/policies'&&req.method==='PATCH'){
   owner(actor);const input=await json(req);
   error(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
   error(isUuid(input.policyId)&&isUuid(input.profileId),'POLICY_ID_REQUIRED');
   error(input.enabled===false,'ONLY_POLICY_DEACTIVATION_SUPPORTED');
   error(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=1,
    'POLICY_REVISION_REQUIRED');
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    // Match policy creation's profile lock: prevents revocation racing checkout
    // and ensures one lock order (profile, then policy) for all policy writers.
    const profile=await client.query('SELECT id FROM satori_v2_profiles WHERE id=$1 FOR UPDATE',
     [input.profileId]);
    error(profile.rows.length===1,'PROFILE_NOT_FOUND',404);
    const changed=await client.query(
     'UPDATE satori_v2_policies SET enabled=false,revision=revision+1 '+
     'WHERE id=$1 AND profile_id=$2 AND revision=$3 AND enabled=true '+
     'RETURNING id,revision,enabled',
     [input.policyId,input.profileId,input.expectedRevision]);
    if(changed.rows.length!==1){
     const found=await client.query('SELECT id,revision,enabled FROM satori_v2_policies '+
      'WHERE id=$1 AND profile_id=$2',[input.policyId,input.profileId]);
     error(found.rows.length===1,'POLICY_NOT_FOUND',404);
     throw new ApiError('POLICY_REVISION_CONFLICT',409);
    }
    await client.query(
     'INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
     'VALUES($1,$2,$3,$4,$5)',
     [actor.id,'owner','POLICY_DISABLED',input.policyId,JSON.stringify({
      profileId:input.profileId,revision:changed.rows[0].revision})]);
    await client.query('COMMIT');
    send(res,200,{ok:true,policy:changed.rows[0]});return true;
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
   finally{client.release()}
  }
  if(pathname==='/api/v2/admin/catalogue/refresh'&&req.method==='POST'){
   owner(actor);
   const input=await json(req);
   error(input.confirmed===true,'OWNER_CONFIRMATION_REQUIRED',403);
   const snapshot=validateCanonicalCatalogue(await readMinhSatori('catalogue.list',{}));
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    // Protect against concurrent admin refresh and an older snapshot restoring stale prices.
    await client.query('SELECT pg_advisory_xact_lock($1,$2)',[20261025,2]);
    const existing=await client.query('SELECT COALESCE(MAX(revision),0) AS revision FROM satori_v2_catalogue');
    error(snapshot.revision>=existing.rows[0].revision,'CATALOGUE_REVISION_STALE',409);
    await client.query('UPDATE satori_v2_catalogue SET active=false,revision=$1 WHERE revision<=$1',[snapshot.revision]);
    for(const product of snapshot.products){
     await client.query('INSERT INTO satori_v2_catalogue(code,name,unit,list_price,revision,active) '+
      'VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(code) DO UPDATE '+
      'SET name=EXCLUDED.name,unit=EXCLUDED.unit,list_price=EXCLUDED.list_price,'+
      'revision=EXCLUDED.revision,active=true,updated_at=now()',
      [product.code,product.name,product.unit,product.listPrice,snapshot.revision]);
    }
    const verified=await client.query('SELECT COUNT(*)::int AS count FROM satori_v2_catalogue '+
     'WHERE active=true AND revision=$1',[snapshot.revision]);
    error(verified.rows[0].count===snapshot.products.length,'CATALOGUE_READBACK_MISMATCH',503);
    await client.query('COMMIT');
    send(res,200,{ok:true,source:'verified-satori-ledger',revision:snapshot.revision,
     count:snapshot.products.length});return true;
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  }
  if(pathname==='/api/v2/admin/profiles'&&req.method==='GET'){
   owner(actor);
   const accountId=new URL(req.url,'http://local').searchParams.get('accountId');
   error(isUuid(accountId),'ACCOUNT_INVALID');
   const list=await pool.query('SELECT id,type,display_name AS name,phone,revision FROM satori_v2_profiles '+
    'WHERE account_id=$1 ORDER BY created_at',[accountId]);
   send(res,200,{ok:true,profiles:list.rows});return true;
  }
  if(pathname==='/api/v2/admin/addresses'&&req.method==='GET'){
   owner(actor);
   const profileId=new URL(req.url,'http://local').searchParams.get('profileId');
   error(isUuid(profileId),'PROFILE_INVALID');
   const list=await pool.query('SELECT id,label,recipient_name AS "recipientName",'+
    'recipient_phone AS "recipientPhone",address,active,revision FROM satori_v2_addresses '+
    'WHERE profile_id=$1 ORDER BY created_at',[profileId]);
   send(res,200,{ok:true,addresses:list.rows});return true;
  }
  if(pathname==='/api/v2/admin/addresses'&&req.method==='POST'){
   owner(actor);const input=await json(req);
   error(isUuid(input.profileId),'PROFILE_INVALID');
   const a=validateAddress(input);
   const profile=await pool.query('SELECT id FROM satori_v2_profiles WHERE id=$1',[input.profileId]);
   error(profile.rows.length===1,'PROFILE_NOT_FOUND',404);
   const saved=await pool.query('INSERT INTO satori_v2_addresses(profile_id,label,recipient_name,recipient_phone,address) '+
    'VALUES($1,$2,$3,$4,$5) RETURNING id',[input.profileId,a.label,a.recipientName,a.recipientPhone,a.address]);
   send(res,201,{ok:true,id:saved.rows[0].id});return true;
  }
  if(pathname==='/api/v2/admin/addresses'&&req.method==='PATCH'){
   owner(actor);
   const input=validateAdminAddressEdit(await json(req));
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    // CAS is scoped to BOTH profile and immutable address ID; no auto-merge.
    // Deactivation immediately prevents new V2 quotes; prior invoices remain intact.
    const saved=await client.query(
     'UPDATE satori_v2_addresses SET label=$3,recipient_name=$4,recipient_phone=$5, '+
     'address=$6,active=$7,revision=revision+1,updated_at=now() '+
     'WHERE id=$1 AND profile_id=$2 AND revision=$8 '+
     'RETURNING id,revision,active',
     [input.addressId,input.profileId,input.label,input.recipientName,
      input.recipientPhone,input.address,input.active,input.expectedRevision]);
    if(saved.rows.length!==1){
     const existing=await client.query('SELECT id FROM satori_v2_addresses WHERE id=$1 AND profile_id=$2',
      [input.addressId,input.profileId]);
     error(existing.rows.length===1,'ADDRESS_NOT_FOUND',404);
     throw new ApiError('ADDRESS_REVISION_CONFLICT',409);
    }
    await client.query(
     'INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
     'VALUES($1,$2,$3,$4,$5)',
     [actor.id,'owner','ADDRESS_EDITED',input.addressId,JSON.stringify({
      profileId:input.profileId,previousRevision:input.expectedRevision,
      newRevision:saved.rows[0].revision,active:input.active
     })]);
    await client.query('COMMIT');
    send(res,200,{ok:true,address:saved.rows[0]});return true;
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
   finally{client.release()}
  }
  if(pathname==='/api/v2/admin/policies'&&req.method==='GET'){
   owner(actor);
   const profileId=new URL(req.url,'http://local').searchParams.get('profileId');
   error(isUuid(profileId),'PROFILE_INVALID');
   const list=await pool.query('SELECT id,address_id AS "addressId",product_code AS "productCode", '+
    'discount_bps AS "discountBps",collaborator_bps AS "collaboratorBps",'+
    'invoice_mode AS "invoiceMode",version,enabled,revision FROM satori_v2_policies '+
    'WHERE profile_id=$1 ORDER BY version DESC,created_at DESC LIMIT 100',[profileId]);
   send(res,200,{ok:true,policies:list.rows});return true;
  }
  if(pathname==='/api/v2/admin/accounts'&&req.method==='GET'){
   owner(actor);
   const r=await pool.query('SELECT id,email,display_name AS name,created_at FROM satori_v2_accounts '+
    'ORDER BY created_at DESC LIMIT 100');
   send(res,200,{ok:true,accounts:r.rows});return true;
  }
  send(res,404,{ok:false,error:'NOT_FOUND'});return true;
 }catch(e){
  const known=e instanceof ApiError||e instanceof DomainError||e instanceof CrmError;
  const status=e instanceof ApiError||e instanceof CrmError?e.status:e instanceof DomainError?409:503;
  send(res,status,{ok:false,error:known?e.code:'ACCOUNT_V2_UNAVAILABLE',
   message:known?e.message:'Hệ thống mới hiện chưa sẵn sàng; dữ liệu cũ không bị ảnh hưởng.'});
  return true;
 }
}
