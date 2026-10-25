/*
 * Account Ordering V2 API. Opt-in, isolated from legacy /real and /ctv.
 * No production invoice writes. PostgreSQL is mandatory for any customer state.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {calculateQuote,normalizeCart,validateAddress,isUuid,isSku,DomainError} from './domain.mjs';
import {parseOrder,identityChange} from '../free-parser.mjs';
import {parseMultiOrder} from '../multi-order.mjs';
import {parseComplexOrderWithGemini} from '../free-parser.mjs';

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
  cfg.databaseUrl&&cfg.ownerGoogleSub&&cfg.pilotSub);
}
function send(res,code,data,headers={}){
 res.writeHead(code,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','x-frame-options':'DENY',
  ...headers});
 res.end(JSON.stringify(data));
}
async function json(req){
 let raw='',length=0;
 for await(const chunk of req){
  length+=chunk.length;
  if(length>MAX_JSON)throw new ApiError('REQUEST_TOO_LARGE',413);
  raw+=chunk.toString('utf8');
 }
 try{
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
  'SELECT a.id,a.google_sub,a.email,a.display_name,s.csrf_hash FROM satori_v2_sessions s '+
  'JOIN satori_v2_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()',
  [sha(raw)]);
 error(r.rows.length===1,'SESSION_EXPIRED',401);
 const actor=r.rows[0];
 // Pilot is ALWAYS owner only. Never enable customer onboarding during migration.
 error(actor.google_sub===config().pilotSub,'PILOT_OWNER_ONLY',403);
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
function publicUser(actor){return {id:actor.id,email:actor.email,name:actor.display_name,isAdmin:actor.google_sub===config().ownerGoogleSub}}
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
 error(payload.sub===config().pilotSub,'PILOT_OWNER_ONLY',403);
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const account=await conn.query('INSERT INTO satori_v2_accounts(google_sub,email,display_name) VALUES($1,$2,$3) '+
   'ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,updated_at=now() RETURNING id,email,display_name',
    [payload.sub,payload.email||'',payload.name||'']);
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
  const version=await client.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM satori_v2_policies '+
   'WHERE profile_id=$1 AND address_id IS NOT DISTINCT FROM $2 AND product_code IS NOT DISTINCT FROM $3',
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
async function quote(pool,actor,input){
 const profile=await profileFor(pool,actor,input.profileId);
 error(isUuid(input.addressId),'ADDRESS_REQUIRED');
 const addressRow=await pool.query('SELECT id,profile_id AS "profileId",active FROM satori_v2_addresses '+
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
 const r=await pool.query('INSERT INTO satori_v2_quotes(account_id,profile_id,address_id,payload,cart_revision,catalogue_revision,expires_at) '+
  'VALUES($1,$2,$3,$4,$5,$6,now()+interval \'10 minutes\') RETURNING id,expires_at',
  [actor.id,profile.id,input.addressId,JSON.stringify(priced),cartRow.rows[0].revision,cat.rows[0].revision]);
 return {quoteId:r.rows[0].id,expiresAt:r.rows[0].expires_at,...priced,
  note:'Báo giá kiểm thử. Chưa tạo hóa đơn thật hoặc ghi công nợ.'};
}
async function interpret(input){
 error(typeof input.message==='string'&&input.message.trim().length>=2&&input.message.length<=500,'MESSAGE_INVALID');
 const message=input.message.trim();
 if(identityChange(message))return {needsClarification:true,message:'Vui lòng chọn địa chỉ đã lưu. Đổi người nhận hoặc số điện thoại cần xác minh riêng.'};
 let parsed=parseMultiOrder(message,{});
 if(!parsed)parsed=await parseComplexOrderWithGemini(message,{});
 if(!parsed){
  const one=await parseOrder(message,{});
  if(one?.sku&&isSku(one.sku)&&Number.isInteger(one.qty)&&one.qty>0&&!one.needsHuman&&!one.needMoreDetails)
   parsed={items:[{sku:one.sku,qty:one.qty}],source:one.source};
  else if(one?.sku&&['S500','S350','S5L'].includes(one.sku)&&Number.isInteger(one.qty)&&one.qty>0&&
   !one.needsHuman&&!one.needMoreDetails){
   const aliases={S500:'TP-00003',S350:'TP-00001',S5L:'TP-00136'};
   parsed={items:[{sku:aliases[one.sku],qty:one.qty}],source:one.source};
  }else return {needsClarification:true,message:'Anh/chị vui lòng ghi rõ tên, quy cách và số lượng sản phẩm.'};
 }
 if(!Array.isArray(parsed.items)||!parsed.items.length||parsed.needMoreDetails)
  return {needsClarification:true,message:'Cần xác nhận lại từng mặt hàng trước khi thêm vào giỏ.'};
 const items=normalizeCart(parsed.items.map(x=>({code:x.sku,qty:x.qty})));
 return {suggestedItems:items,source:parsed.source||'validated',message:'Đã hiểu các mặt hàng. Kiểm tra rồi chọn Thêm vào giỏ chung.'};
}
export async function handleAccountV2(req,res,pathname){
 const page=pathname==='/app-v2'||pathname==='/app-v2/';
 const api=pathname.startsWith('/api/v2/');
 if(!page&&!api)return false;
 try{
  if(page){
   const html=fs.readFileSync(path.join(HERE,'app.html'),'utf8');
   res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'x-frame-options':'DENY','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://accounts.google.com/gsi/client; connect-src 'self'; img-src 'self' data:; frame-src https://accounts.google.com; frame-ancestors 'none'; form-action 'none'; base-uri 'none'"});
   res.end(html);return true;
  }
  if(pathname==='/api/v2/status'&&req.method==='GET'){
   send(res,200,{...STATUS,enabled:ready(),pilotOnly:true,
    googleClientId:flag()?config().clientId:null,durableStorageReady:!!config().databaseUrl});
   return true;
  }
  error(ready(),'ACCOUNT_V2_DISABLED',503);
  const pool=await db();
  if(pathname==='/api/v2/auth/google'&&req.method==='POST'){
   await login(req,res,pool);return true;
  }
  const actor=await auth(req,pool);
  if(pathname==='/api/v2/me'&&req.method==='GET'){
   const profiles=await pool.query('SELECT id,type,display_name AS name,phone FROM satori_v2_profiles WHERE account_id=$1 ORDER BY created_at',
    [actor.id]);
   const addresses=await pool.query('SELECT a.id,a.profile_id AS "profileId",a.label, '+
    'a.recipient_name AS "recipientName",a.recipient_phone AS "recipientPhone",a.address,a.active '+
    'FROM satori_v2_addresses a JOIN satori_v2_profiles p ON a.profile_id=p.id '+
    'WHERE p.account_id=$1 ORDER BY a.created_at',[actor.id]);
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
  if(pathname==='/api/v2/cart'&&req.method==='GET'){
   const profile=await profileFor(pool,actor,new URL(req.url,'http://local').searchParams.get('profileId'));
   const r=await pool.query('SELECT lines,revision FROM satori_v2_carts WHERE account_id=$1 AND profile_id=$2',
    [actor.id,profile.id]);
   send(res,200,{ok:true,lines:r.rows[0]?.lines||[],revision:r.rows[0]?.revision||0});return true;
  }
  if(pathname==='/api/v2/cart'&&req.method==='PUT'){
   const input=await json(req),profile=await profileFor(pool,actor,input.profileId);
   error(Array.isArray(input.lines),'CART_INVALID');
   const lines=input.lines.length?normalizeCart(input.lines):[];
   const r=await pool.query('INSERT INTO satori_v2_carts(account_id,profile_id,lines) VALUES($1,$2,$3) '+
    'ON CONFLICT(account_id,profile_id) DO UPDATE SET lines=EXCLUDED.lines,revision=satori_v2_carts.revision+1,'+
    'updated_at=now() RETURNING revision',[actor.id,profile.id,JSON.stringify(lines)]);
   send(res,200,{ok:true,lines,revision:r.rows[0].revision});return true;
  }
  if(pathname==='/api/v2/catalogue'&&req.method==='GET'){
   const r=await pool.query('SELECT code,name,unit,list_price AS "listPrice",revision FROM satori_v2_catalogue '+
    'WHERE active=true ORDER BY code LIMIT 200');
   send(res,200,{ok:true,items:r.rows.map(x=>({...x,listPrice:Number(x.listPrice)})),
    catalogueReady:r.rows.length>0});return true;
  }
  if(pathname==='/api/v2/interpret'&&req.method==='POST'){
   const result=await interpret(await json(req));send(res,200,{ok:true,...result});return true;
  }
  if(pathname==='/api/v2/quote'&&req.method==='POST'){
   const result=await quote(pool,actor,await json(req));send(res,200,{ok:true,...result});return true;
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
  if(pathname==='/api/v2/admin/policies'&&req.method==='POST'){
   const r=await adminPolicy(pool,actor,await json(req));
   send(res,201,{ok:true,policy:r});return true;
  }
  if(pathname==='/api/v2/admin/accounts'&&req.method==='GET'){
   owner(actor);
   const r=await pool.query('SELECT id,email,display_name AS name,created_at FROM satori_v2_accounts '+
    'ORDER BY created_at DESC LIMIT 100');
   send(res,200,{ok:true,accounts:r.rows});return true;
  }
  send(res,404,{ok:false,error:'NOT_FOUND'});return true;
 }catch(e){
  const known=e instanceof ApiError||e instanceof DomainError;
  const status=e instanceof ApiError?e.status:e instanceof DomainError?409:503;
  send(res,status,{ok:false,error:known?e.code:'ACCOUNT_V2_UNAVAILABLE',
   message:known?e.message:'Hệ thống mới hiện chưa sẵn sàng; dữ liệu cũ không bị ảnh hưởng.'});
  return true;
 }
}
