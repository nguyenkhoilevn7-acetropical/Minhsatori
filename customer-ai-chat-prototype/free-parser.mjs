/* SANDBOX: rule-first Vietnamese order parser, optional Cloudflare Workers AI Free. Never touches price or customer identity. */
const SKUS=new Set(['S5L','S500','S350']);
const MODEL='@cf/meta/llama-3.2-3b-instruct';
const words={mot:1,hai:2,ba:3,bon:4,tu:4,nam:5,lam:5,sau:6,bay:7,tam:8,chin:9,muoi:10};
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/\s+/g,' ').trim();
function hints(s){const a=[];if(/\b5\s*(?:l|lit|liter)\b/.test(s))a.push('S5L');if(/\b500\s*ml\b/.test(s))a.push('S500');if(/\b350\s*ml\b/.test(s))a.push('S350');return a;}
function qty(s){let m=s.match(/\b(\d{1,4})\s*(?:thung|thg|t)(?=\s|$|[.,!?;])/);if(m)return Number(m[1]);m=s.match(/\b(muoi\s+(?:mot|hai|ba|bon|nam|lam|sau|bay|tam|chin)|hai\s+muoi|ba\s+muoi|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi)\s+(?:thung|thg)\b/);if(!m)return 0;const p=m[1].split(' ');return p[0]==='muoi'&&p[1]?10+words[p[1]]:p[1]==='muoi'?10*words[p[0]]:words[p[0]]||0;}
const last=s=>/\b(nhu lan truoc|don cu|don truoc|dat lai|nhu cu|nhu moi khi)\b/.test(s);
const unsupported=s=>/\b(mang cau|oi hong|nuoc ep|tra sua|ca phe|coffee|bia|tra nho|sua tuoi)\b/.test(s);
export function identityChange(message,profile={}){
 const s=norm(message);
 if(/\b(doi dia chi|dia chi moi|chuyen dia chi|nguoi nhan khac|doi nguoi nhan|doi sdt|sdt moi|so dien thoai moi|giao sang|giao cho nguoi khac|giao den dia chi khac|giao ve dia chi khac|dia chi khac)\b/.test(s))return true;
 if(/\b(giao|ship|gui)\s+(?:den|toi|ve)\s+\d{2,5}\s+\w/.test(s))return true;
 const known=String(profile.phone||'').replace(/\D/g,'');
 return (s.match(/(?:\+?84|0)\d{8,10}\b/g)||[]).some(v=>{const p=v.replace(/\D/g,'');return p!==known&&'0'+p.replace(/^84/,'')!==known});
}
export function parseRules(message,profile={}){
 const s=norm(message),h=hints(s),reuse=last(s);
 if(identityChange(message,profile))return {intent:'order',sku:'unknown',qty:0,needsHuman:true,reason:'CHANGE',source:'rules'};
 if(unsupported(s)||h.length>1)return {intent:'order',sku:'unknown',qty:0,needMoreDetails:true,reason:h.length>1?'MULTI_SKU':'UNSUPPORTED',source:'rules'};
 if(/\b(khong dat|huy don|dung giao|thoi khong|chua dat)\b/.test(s))return {intent:'other',sku:'unknown',qty:0,source:'rules'};
 if(!/\b(dat|mua|lay|cho|can|giao|them|gui|order|thung|nhu lan truoc|nhu cu)\b/.test(s))return null;
 const n=qty(s)||(reuse?Number(profile.lastQty||0):0);
 const sku=h[0]||((reuse||profile.uniqueFavourite)?profile.favourite:null);
 if(!SKUS.has(sku)||!Number.isSafeInteger(n)||n<1)return {intent:'order',sku:'unknown',qty:0,needMoreDetails:true,reason:'UNCLEAR',source:'rules'};
 return {intent:'order',sku,qty:n,source:'rules'};
}
export function cfConfigured(){return !!(String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim()&&String(process.env.CLOUDFLARE_API_TOKEN||'').trim())}
let day='',requests=0;
function quota(){const date=new Date().toISOString().slice(0,10);if(date!==day){day=date;requests=0}const cap=Math.max(0,Math.min(250,Number(process.env.CF_DAILY_CALL_LIMIT||100)));if(requests>=cap)return false;requests++;return true}
function jsonText(s){const str=String(s||'').trim().replace(/^[\x60]+(?:json)?\s*/i,'').replace(/[\x60]+$/,'').trim();try{return JSON.parse(str)}catch{}const a=str.indexOf('{'),b=str.lastIndexOf('}');if(a<0||b<=a)return null;try{return JSON.parse(str.slice(a,b+1))}catch{return null}}
async function callCF(message){
 if(!cfConfigured()||!quota())return null;
 const id=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim(),token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
 if(!/^[a-zA-Z0-9_-]{6,100}$/.test(id))return null;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4800);
 try{
  const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+id+'/ai/run/'+MODEL,{method:'POST',signal:controller.signal,
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({messages:[
    {role:'system',content:'Trả về JSON thuần: {"intent":"order" hoặc "other", "sku":"S5L" hoặc "S500" hoặc "S350" hoặc "unknown", "qty":số nguyên, "use_last_order":boolean, "address_change":boolean, "receiver_or_phone_change":boolean}. Đây là bộ hiểu tin nhắn đặt nước tiếng Việt, 5L=S5L, 500ml=S500, 350ml=S350. Không chắc thì unknown, qty=0. Không tính giá, không tự tạo đơn.'},
    {role:'user',content:message}],temperature:0,max_tokens:150,stream:false})});
  if(!r.ok)return null;const data=await r.json();if(!data?.success||typeof data?.result?.response!=='string')return null;
  const p=jsonText(data.result.response);return p&&['order','other'].includes(p.intent)&&['S5L','S500','S350','unknown'].includes(p.sku)&&Number.isSafeInteger(p.qty)&&p.qty>=0?p:null;
 }catch{return null}finally{clearTimeout(timeout)}
}
export async function parseOrder(message,profile={}){
 const r=parseRules(message,profile);
 if(r?.needsHuman||['UNSUPPORTED','MULTI_SKU'].includes(r?.reason)||r&&!r.needMoreDetails)return r;
 if(!cfConfigured())return r||{intent:'other',sku:'unknown',qty:0,source:'rules'};
 const p=await callCF(message);if(!p)return r||{intent:'other',sku:'unknown',qty:0,source:'rules'};
 if(p.address_change||p.receiver_or_phone_change)return {...p,needsHuman:true,source:'cloudflare'};
 if(p.intent!=='order')return {...p,source:'cloudflare'};
 const s=norm(message),h=hints(s),reuse=last(s);
 if(h.length>1||unsupported(s))return {intent:'order',sku:'unknown',qty:0,needMoreDetails:true,source:'rules'};
 // Never allow a model to guess an SKU absent from the customer's words or unique purchase history.
 const sku=h[0]||((reuse||profile.uniqueFavourite)?profile.favourite:null);
 const n=qty(s)||(reuse?Number(profile.lastQty||0):0)||(/\d|thung|thg/.test(s)?p.qty:0);
 if(!SKUS.has(sku)||!Number.isSafeInteger(n)||n<1)return {intent:'order',sku:'unknown',qty:0,needMoreDetails:true,source:'cloudflare'};
 return {intent:'order',sku,qty:n,source:'cloudflare'};
}
