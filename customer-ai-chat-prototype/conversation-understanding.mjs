/**
 * Isolated, server-side conversation comprehension. Does not alter model weights.
 * No phone, address, identity, pricing or raw customer tokens go to Gemini.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fold,productFor,resolveProduct} from './catalogue.mjs';

export const ADDRESS_REPLY='Để thay đổi địa chỉ giao hàng, anh/chị vui lòng liên hệ trực tiếp anh Nguyên hoặc anh Minh để được hỗ trợ. AI không tự thay đổi địa chỉ.';
// Brand-neutral requests for water 500ml now default to Satori.
// Keep these exports as compatibility shims: no new brand-only pending state.
export function ambiguousWater500(_msg){return null}
export function ambiguousWater500InComposite(_message){return false}
export function brandAnswer(msg){
 const m=fold(msg).replace(/[.!?]+$/,'').match(/^(?:nuoc\s+)?(?:hang\s+)?(satori|hikari)(?:\s+500(?:\s*ml)?)?$/);
 return m?{sku:m[1]==='satori'?'TP-00003':'TP-00081',brand:m[1]}:null;
}
const ADDRESS=/\b(?:doi\s+(?:dia chi|noi giao|noi nhan)|thay\s+(?:dia chi|noi giao)|dia chi moi|chuyen dia chi|cap nhat dia chi|giao sang|giao ve dia chi khac|giao den dia chi khac|giao cho nguoi khac|ship sang|ship den dia chi|giao qua dia chi|doi noi giao|doi cho giao)\b/;
const PHONE=/\b(?:doi|sua|thay|cap nhat|chinh sua|muon doi|cho doi)\s+(?:so dien thoai|sdt|so dt|so lien he|so nhan hang)\b|\b(?:sdt moi|so dien thoai moi|so lien he moi)\b/;
export function contactIntent(msg){
 const s=fold(msg),address=ADDRESS.test(s)||/\b(?:giao(?: hang)?|ship|gui)\s+(?:den|toi|ve|sang)\s+(?:dia chi|nha|so\s+\d{1,4}\s+\w+|\d{1,4}\s+\w+)/.test(s);
 const phone=PHONE.test(s);
 if(!address&&!phone)return null;
 const matches=phone?(String(msg).match(/(?:\+?84|0)(?:[\s().-]*\d){9,10}(?!\d)/g)||[]):[];
 const phoneNumber=(matches.at(-1)||'').replace(/\D/g,'').replace(/^84(?=\d{9}$)/,'0');
 return {address,phone,phoneNumber:/^0\d{9}$/.test(phoneNumber)?phoneNumber:''};
}
export const phoneConfirm=s=>/^(xac nhan doi (?:sdt|so dien thoai)|dung so (?:dien thoai )?nay)$/i.test(fold(s));
export const phoneCancel=s=>/^(huy|khong|thoi|huy doi so|khong doi nua)$/i.test(fold(s));
export const maskPhone=s=>s?s.slice(0,3)+'***'+s.slice(-3):'';

const generic=new Set(['nuoc','suoi','nuoc suoi','suoi 500','nuoc suoi 500','nuoc 500','500','500ml','500 ml','satori','hikari','mang cau','oi hong','me','premium','5l','5 l']);
const validAlias=s=>/^[a-z0-9 ]{4,42}$/.test(s)&&!generic.has(s)&&!/\b(sdt|dia chi|email|mat khau|token|otp|pass)\b/.test(s)&&!/\d{4,}/.test(s);
export function trainingProposal(message){
 const n=fold(message).replace(/[“”"']/g,'');
 const m=n.match(/^(?:(?:nho|ghi nho|hoc giup|hay nho)\s*[:,]?\s*)?khi (?:toi|anh|chi|em|minh) noi (.{4,46}?)\s+(?:thi|nghia la|tuc la|la)\s+(.{4,100})[.!?]?$/)
  ||n.match(/^(?:nho|ghi nho)\s+(?:cum|ten|cach goi)\s+(.{4,46}?)\s+(?:la|nghia la)\s+(.{4,100})[.!?]?$/);
 if(!m)return null;
 const alias=m[1].trim(),target=m[2].replace(/[.!?]+$/,'').trim();
 if(!validAlias(alias))return {invalid:true,message:'Cách viết tắt quá chung, có nguy cơ nhầm sản phẩm. Hãy chọn cách gọi riêng rõ hơn.'};
 const r=resolveProduct(target),p=r.sku&&!r.ambiguous?productFor(r.sku):null;
 if(!p)return {invalid:true,message:'Em chưa xác định được mã sản phẩm chính xác, vui lòng ghi đủ hãng và dung tích.'};
 return {alias,code:p.code,label:p.name};
}
export const trainingConfirm=s=>/^(xac nhan|dong y|dung roi|dung|nho di|hay nho|ok|vang)$/i.test(fold(s));
export const trainingCancel=s=>/^(khong|huy|thoi|khong nho|khong dong y)$/i.test(fold(s));
export function trainingForget(message){
 const m=fold(message).match(/^(?:quen|xoa ghi nho|khong nho nua|bo ghi nho)\s+(?:cum|ten|cach goi)?\s*(.{4,42}?)\s*[.!?]?$/);
 return m?.[1]?.trim()||null;
}
export function makeCustomerPhraseMemory(dataDir){
 const filename=path.join(dataDir,'customer-phrases-SANDBOX.json');
 let records=[];
 if(fs.existsSync(filename)){
  const arr=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!Array.isArray(arr)||arr.length>1500)throw Error('INVALID_PHRASE_MEMORY');
  for(const x of arr)if(!x||!/^[a-f0-9]{64}$/.test(x.key)||!validAlias(x.alias)||!productFor(x.code)||!Number.isSafeInteger(x.updatedAt))throw Error('INVALID_PHRASE_MEMORY');
  records=arr;
 }
 const keyFor=token=>crypto.createHash('sha256').update('satori-conversation-alias-v1:'+token).digest('hex');
 const flush=()=>{
  const tmp=filename+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(records),{mode:0o600,flag:'wx'});fs.renameSync(tmp,filename)}
  catch(e){try{fs.unlinkSync(tmp)}catch{}throw e}
 };
 const list=token=>records.filter(x=>x.key===keyFor(token)).map(({alias,code})=>({alias,code}));
 function remember(token,proposal){
  if(!proposal||!validAlias(proposal.alias)||!productFor(proposal.code))throw Error('INVALID_ALIAS');
  const prior=records,k=keyFor(token),mine=list(token).filter(x=>x.alias!==proposal.alias);
  if(mine.length>=20)throw Error('ALIAS_LIMIT');
  records=[...records.filter(x=>x.key!==k),...mine.map(x=>({key:k,...x,updatedAt:Date.now()})),{key:k,alias:proposal.alias,code:proposal.code,updatedAt:Date.now()}];
  try{flush()}catch(e){records=prior;throw e}
  return list(token);
 }
 function forget(token,alias){
  const prior=records,k=keyFor(token);
  records=records.filter(x=>!(x.key===k&&x.alias===fold(alias)));
  if(prior.length!==records.length)try{flush()}catch(e){records=prior;throw e}
  return list(token);
 }
 function expand(token,message){
  let result=String(message);
  const accent={
   a:'aàáảãạăằắẳẵặâầấẩẫậ',e:'eèéẻẽẹêềếểễệ',
   i:'iìíỉĩị',o:'oòóỏõọôồốổỗộơờớởỡợ',
   u:'uùúủũụưừứửữự',y:'yỳýỷỹỵ',d:'dđ'
  };
  // Unicode-aware whole-phrase replacement keeps original Vietnamese accents,
  // punctuation, delivery times, identity warnings and customer wording intact.
  for(const item of list(token).sort((a,b)=>b.alias.length-a.alias.length)){
   const pattern=[...item.alias].map(ch=>ch===' '?'\\s+':accent[ch]?'['+accent[ch]+']':ch).join('');
   const re=new RegExp('(^|[^\\p{L}\\p{N}])('+pattern+')(?=$|[^\\p{L}\\p{N}])','giu');
   result=result.replace(re,(whole,prefix)=>prefix+item.code);
  }
  return result;
 }
 function snapshot(){return records.map(x=>({...x}))}
 function restore(rows){
  if(records.length)throw Error('PHRASE_MEMORY_NOT_EMPTY');
  if(!Array.isArray(rows)||rows.length>1500)throw Error('INVALID_PHRASE_MEMORY');
  const seen=new Set();
  for(const x of rows){
   if(!x||!/^[a-f0-9]{64}$/.test(x.key)||!validAlias(x.alias)||!productFor(x.code)||
       !Number.isSafeInteger(x.updatedAt)||x.updatedAt<1||x.updatedAt>Date.now()+60000)
     throw Error('INVALID_PHRASE_MEMORY');
   const id=x.key+'|'+x.alias;
   if(seen.has(id))throw Error('INVALID_PHRASE_MEMORY');
   seen.add(id);
  }
  const old=records;
  records=rows.map(x=>({key:x.key,alias:x.alias,code:x.code,updatedAt:x.updatedAt}));
  try{flush()}catch(e){records=old;throw e}
 }
 return {list,remember,forget,expand,snapshot,restore};
}
export const GEMINI_FEW_SHOTS=[
 '10 thùng nước suối 500: mặc định 10 thùng Satori 500ml; không hỏi hãng',
 '10 suối 350: hiểu 10 thùng Satori 350ml; không hỏi hãng',
 '10 thùng Hikari 500ml: chọn Hikari rõ hãng; không đổi thành Satori',
 '10 suối 500 Satori: 10 thùng Satori 500ml',
 '5 thùng Hikari 500ml, 3 thùng mãng cầu: 2 sản phẩm, 1 giỏ',
 'mãng cầu 3 thùng, ổi hồng 2 thùng: giữ cả hai món',
 '5L có vòi và 5L không vòi: hai biến thể khác nhau',
 '1 bình 5L có vòi: không chuyển bình thành thùng',
 '2 giờ chiều giao giúp: thời gian giao, không phải 2 thùng',
 'đổi địa chỉ: liên hệ trực tiếp anh Nguyên hoặc anh Minh',
 'đổi sđt: xác nhận, xác minh người sở hữu, không sửa từ AI đơn thuần',
 '3 thùng trà sữa và 10 thùng Satori: hỏi món không có trong danh mục, không làm bill thiếu',
 '10 lon ổi hồng: không chuyển lon thành thùng',
 'đơn cũ: hỏi rõ và xác nhận trước khi tạo bill',
 'giao sau 2 tiếng: ghi chú yêu cầu, không cam kết',
 '10 thùng Satori 500ml và 3 thùng Satori 500ml: gộp 13 thùng, 1 dòng'
];
export function syntheticOrderCases(){
 const products=['Satori 500ml','Hikari 500ml','Satori 350ml','nước ép mãng cầu','nước ép ổi hồng','Premium 450ml'];
 const verbs=['Cho tôi','Anh lấy','Mình mua','Đặt giúp','Cần',''];
 const counts=[1,2,3,5,10,12,20,30,50];
 const cases=[];
 for(const name of products)for(const qty of counts)for(const verb of verbs)
  cases.push({text:(verb+' '+qty+' thùng '+name).trim(),qty,kind:'synthetic-order'});
 for(const qty of [1,5,10,20,50])for(const verb of ['Cho tôi','Anh lấy','Cần',''])
  cases.push({text:(verb+' '+qty+' thùng nước suối 500').trim(),qty,kind:'synthetic-order',sku:'TP-00003'});
 return cases;
}
