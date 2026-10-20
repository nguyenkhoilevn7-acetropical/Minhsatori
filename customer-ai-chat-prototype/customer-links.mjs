/**
 * Separate sandbox-only customer link manager.
 * Real customer information must NOT be imported before production authentication,
 * durable storage, and an approved verified customer data bridge exist.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const now=()=>new Date().toISOString();
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
const newToken=()=>crypto.randomBytes(32).toString('base64url');
const safeText=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';
const numberIn=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const VAT_RATES=new Set([0,5,8,10]);
const normalizedPhone=s=>String(s||'').replace(/\D/g,'').replace(/^84(?=\d{9}$)/,'0');
// Accept printable, space-free secrets (including standard base64 + / =), not just base64url.
const bearer=header=>{
 const match=/^Bearer ([\x21-\x7e]{32,256})$/.exec(String(header||''));
 return match?.[1]||'';
};

export function makeCustomerLinks(dataDir){
 const filename=path.join(dataDir,'customer-links-SANDBOX.json');
 let profiles=[];
 try{const loaded=JSON.parse(fs.readFileSync(filename,'utf8'));if(Array.isArray(loaded))profiles=loaded.filter(x=>x&&typeof x.id==='string'&&typeof x.tokenHash==='string')}catch{}
 const requestsFile=path.join(dataDir,'customer-change-requests-SANDBOX.json');
 let changeRequests=[];
 try{const loaded=JSON.parse(fs.readFileSync(requestsFile,'utf8'));if(Array.isArray(loaded))changeRequests=loaded.filter(x=>x&&typeof x.id==='string'&&typeof x.profileId==='string').slice(0,500)}catch{}
 const saveRequests=()=>{
  const tmp=requestsFile+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(changeRequests,null,2),{mode:0o600});
  fs.renameSync(tmp,requestsFile);
 };
 const pendingCount=()=>changeRequests.filter(x=>x.status==='pending').length;
 // Customer chat NEVER changes an existing link's identity, phone or address.
 // Record a request in an owner-only inbox for manual review instead.
 const logChangeRequest=(profile,message)=>{
  const raw=String(message||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,500);
  const recent=changeRequests.find(x=>x.profileId===profile.id&&x.message===raw&&x.status==='pending'&&Date.now()-Date.parse(x.requestedAt)<120000);
  if(recent)return recent;
  const request={id:crypto.randomUUID(),profileId:profile.id,customerName:profile.name,approvedName:profile.name,approvedPhone:profile.phone,approvedAddress:profile.address,message:raw,requestedAt:now(),status:'pending',reviewedAt:null};
  changeRequests.unshift(request);changeRequests=changeRequests.slice(0,500);
  saveRequests();return request;
 };
 const save=()=>{
  const tmp=filename+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(profiles,null,2),{mode:0o600});
  fs.renameSync(tmp,filename);
 };
 const getProfile=token=>{
  if(typeof token!=='string'||token.length<40||token.length>96)return null;
  const h=hash(token);
  return profiles.find(x=>x.enabled&&x.tokenHash===h)||null;
 };
 const authorized=req=>{
  const expected=(process.env.CUSTOMER_LINKS_ADMIN_TOKEN||'').trim();
  const supplied=bearer(req.headers.authorization);
  if(expected.length<32||!supplied)return false;
  return crypto.timingSafeEqual(Buffer.from(hash(supplied)),Buffer.from(hash(expected)));
 };
 const api=(res,status,object)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(object));
 };
 const no=(res,status,error,message)=>api(res,status,{ok:false,error,message});
 const publicProfile=p=>({id:p.id,name:p.name,phone:p.phone,address:p.address,discount:p.discount,ship:p.ship,vatRate:p.vatRate??0,enabled:p.enabled,createdAt:p.createdAt,updatedAt:p.updatedAt});
 const link=(req,token)=>{
  // Host is derived from the trusted Render service rather than untrusted Host headers.
  const origin=process.env.CUSTOMER_LINKS_ORIGIN||'https://minh-satori-customer-ai-gemini.onrender.com';
  return origin.replace(/\/$/,'')+'/c/'+encodeURIComponent(token);
 };
 const handleAdmin=async(req,res,url,bodyJSON)=>{
  const p=url.pathname;
  if(!p.startsWith('/api/admin/customers')&&!p.startsWith('/api/admin/change-requests')&&p!=='/api/admin/status')return false;
  if(!authorized(req)) {no(res,401,'ADMIN_AUTH_REQUIRED','Đăng nhập quản trị riêng mới được quản lý liên kết khách.');return true}
  if(p==='/api/admin/status'&&req.method==='GET'){api(res,200,{ok:true,sandbox:true,customerLinks:true,pendingChangeRequests:pendingCount()});return true}
  if(p==='/api/admin/change-requests'&&req.method==='GET'){
   api(res,200,{ok:true,sandbox:true,pendingCount:pendingCount(),requests:changeRequests.slice(0,100)});return true;
  }
  const requestAction=/^\/api\/admin\/change-requests\/([0-9a-f-]{36})\/review$/.exec(p);
  if(requestAction&&req.method==='POST'){
   const entry=changeRequests.find(x=>x.id===requestAction[1]);
   if(!entry){no(res,404,'NOT_FOUND','Không tìm thấy yêu cầu thay đổi');return true}
   entry.status='reviewed';entry.reviewedAt=now();saveRequests();
   api(res,200,{ok:true,request:entry,pendingCount:pendingCount(),notice:'Đã đánh dấu xem. Không có thay đổi nào được áp dụng cho thông tin khách hoặc link.'});return true;
  }
  if(p==='/api/admin/customers'&&req.method==='GET'){
   api(res,200,{ok:true,sandbox:true,customers:profiles.map(publicProfile)});return true;
  }
  if(p==='/api/admin/customers'&&req.method==='POST'){
   if(profiles.length>=250){no(res,409,'DEMO_LIMIT','Bản thử nghiệm chỉ hỗ trợ 250 hồ sơ.');return true}
   const b=await bodyJSON(req);
   const name=safeText(b?.name,120),phone=safeText(b?.phone,30),address=safeText(b?.address,300);
   const discount=Number(b?.discount),ship=Number(b?.ship),vatRate=Number(b?.vatRate??0);
   if(name.length<2||phone.length<8||address.length<5||!numberIn(discount,0,70)||!numberIn(ship,0,30)||!VAT_RATES.has(vatRate)){
    no(res,400,'INVALID_PROFILE','Nhập đủ tên, số điện thoại, địa chỉ và chiết khấu (0–70%), phí vận chuyển (0–30%).');return true;
   }
   if(!/^[+\d\s().-]{8,30}$/.test(phone)){
    no(res,400,'INVALID_PHONE','Số điện thoại không hợp lệ.');return true;
   }
   if(profiles.some(x=>normalizedPhone(x.phone)===normalizedPhone(phone))){
    no(res,409,'DUPLICATE_CUSTOMER','Số điện thoại đã thuộc một khách thử. Hãy chọn khách đã có thay vì tạo trùng.');return true;
   }
   const token=newToken();
   const c={id:'KH-SANDBOX-'+crypto.randomUUID(),name,phone,address,discount,ship,vatRate,enabled:true,tokenHash:hash(token),createdAt:now(),updatedAt:now(),favourite:null,lastQty:0,uniqueFavourite:false};
   profiles.unshift(c);save();
   api(res,201,{ok:true,sandbox:true,customer:publicProfile(c),customerLink:link(req,token),notice:'Chỉ dùng với dữ liệu giả. Sao chép link ngay; hệ thống không lưu token dạng rõ.'});return true;
  }
  const m=/^\/api\/admin\/customers\/(KH-SANDBOX-[0-9a-f-]{36})\/(rotate|revoke)$/.exec(p);
  if(m&&req.method==='POST'){
   const c=profiles.find(x=>x.id===m[1]);
   if(!c){no(res,404,'NOT_FOUND','Không tìm thấy hồ sơ thử');return true}
   c.updatedAt=now();
   if(m[2]==='revoke'){
    c.enabled=false;save();api(res,200,{ok:true,customer:publicProfile(c),message:'Đã thu hồi liên kết. Hóa đơn thử vẫn giữ lại.'});return true;
   }
   const token=newToken();c.tokenHash=hash(token);c.enabled=true;save();
   api(res,200,{ok:true,customer:publicProfile(c),customerLink:link(req,token),message:'Đã đổi liên kết. Link cũ không còn hiệu lực.'});return true;
  }
  no(res,404,'NOT_FOUND','Không có đường dẫn quản trị này.');return true;
 };
 const history=(res,token,orders,fixtures)=>{
  const c=fixtures[token]||getProfile(token);
  if(!c){no(res,404,'LINK_INVALID','Không có quyền xem lịch sử hóa đơn');return}
  const list=[...orders.values()].filter(o=>o&&o.sandbox&&(o.profileId===c.id||(!o.profileId&&o.token===token)))
   .sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0))
   .map(o=>({ref:o.ref,createdAt:o.createdAt,product:o.product||'',qty:o.qty||0,unit:o.unit||'thùng',items:Array.isArray(o.items)?o.items:[],total:o.total||0,status:o.status||'Chưa thanh toán',deliveryNote:o.deliveryNote||'',hasPdf:true}));
  api(res,200,{ok:true,sandbox:true,profileId:c.id,timezone:'Asia/Ho_Chi_Minh',count:list.length,orders:list,notice:'Dữ liệu chỉ là bản thử, không phải lịch sử hóa đơn website thật.'});
 };
 return {getProfile,handleAdmin,history,logChangeRequest};
}
