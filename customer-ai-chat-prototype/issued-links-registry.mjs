/**
 * Durable owner-only link directory transport.
 * One canonical HMAC writer key talks directly to the versioned Satori Drive
 * ledger. No ephemeral Render disk state or browser localStorage is trusted.
 * PINs are not stored in the registry. Successful issue requires Drive readback.
 */
import crypto from 'node:crypto';

const fail=(code)=>{throw Object.assign(new Error(code),{code})};
const idForLink=link=>'il_'+crypto.createHash('sha256').update(link,'utf8').digest('hex').slice(0,32);
const validLink=link=>typeof link==='string'&&link.length>=80&&link.length<=16000&&
 /^https:\/\/minh-satori-customer-ai-gemini\.onrender\.com\/(?:real|ctv)\/#[-_A-Za-z0-9.]{50,15000}$/.test(link);
const asText=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():fail('LINK_RECORD_INVALID');
const integer=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const ref=source=>{
 if(!source||source.id==null||!Number.isSafeInteger(source.invoiceNo)||source.invoiceNo<1)
  fail('LINK_RECORD_INVALID');
 return {id:String(source.id),invoiceNo:source.invoiceNo};
};
const recipient=d=>{
 if(!d||!integer(d.discountPercent,70))fail('LINK_RECORD_INVALID');
 return {customerRef:ref(d.customerRef),name:asText(d.name,150),
  phone:asText(d.phone,35),location:asText(d.location,500),
  discountPercent:d.discountPercent};
};

export function createIssuedLinksRegistry({bot,now=Date.now}={}){
 if(typeof bot!=='function')fail('LINK_REGISTRY_DEPENDENCY_MISSING');
 async function list({id,offset=0,limit=8}={}){
  if(!Number.isSafeInteger(offset)||offset<0||offset>500||
     !Number.isSafeInteger(limit)||limit<1||limit>12||
     (id!==undefined&&!/^il_[a-f0-9]{32}$/.test(id)))fail('LINK_RECORD_INVALID');
  const reply=await bot('links.list',{...(id?{id}:{}),offset,limit});
  if(!Number.isSafeInteger(reply.revision)||!Array.isArray(reply.data?.items)||
     !Number.isSafeInteger(reply.data.total)||typeof reply.data.hasMore!=='boolean')
   fail('LINK_REGISTRY_READ_UNVERIFIED');
  const items=reply.data.items.map(x=>{
   if(!x||!/^il_[a-f0-9]{32}$/.test(x.id||'')||
      !['agency','customer','collaborator'].includes(x.kind)||
      !validLink(x.link)||!Array.isArray(x.recipients)||x.recipients.length>20)
    fail('LINK_REGISTRY_READ_UNVERIFIED');
   return {...x,expired:!!x.expiresAt&&Date.parse(x.expiresAt)<=now()};
  });
  return {revision:reply.revision,total:reply.data.total,
   hasMore:reply.data.hasMore,items};
 }
 async function register({kind,name,link,recipients,collaboratorId=null,
   issuedAt=new Date(now()).toISOString(),expiresAt=null,
   shippingPercent=0,vatPercent=0}={}){
  if(!['agency','customer','collaborator'].includes(kind)||
     !validLink(link)||!Array.isArray(recipients)||recipients.length<1||
     recipients.length>20||!integer(shippingPercent,30)||
     ![0,5,8,10].includes(vatPercent)||
     (kind==='collaborator')!==link.includes('/ctv/#'))
   fail('LINK_RECORD_INVALID');
  const record={id:idForLink(link),kind,name:asText(name,150),link,
   issuedAt:new Date(issuedAt).toISOString(),expiresAt:expiresAt?new Date(expiresAt).toISOString():null,
   collaboratorId:kind==='collaborator'?asText(collaboratorId,100):null,
   shippingPercent,vatPercent,recipients:recipients.map(recipient)};
  for(let attempt=0;attempt<2;attempt++){
   const current=await bot('system.status',{});
   if(!Number.isSafeInteger(current.revision))fail('LINK_REGISTRY_REVISION_INVALID');
   try{
    const saved=await bot('links.register',{expectedRevision:current.revision,
     confirmed:true,record});
    if(saved.data?.saved!==true||saved.data.id!==record.id||
       (saved.data.duplicate!==true&&saved.backupCreated!==true))
     fail('LINK_REGISTRY_WRITE_UNVERIFIED');
    const confirmed=await list({id:record.id,limit:1});
    const match=confirmed.items[0];
    if(confirmed.total!==1||!match||match.link!==record.link||
       match.name!==record.name||match.kind!==record.kind)
     fail('LINK_REGISTRY_READBACK_MISMATCH');
    return {id:record.id,saved:true,duplicate:saved.data.duplicate===true,
     revision:confirmed.revision};
   }catch(e){
    if(e?.code==='REVISION_CONFLICT'&&attempt===0)continue;
    throw e;
   }
  }
  fail('LINK_REGISTRY_REVISION_CONFLICT');
 }
 return Object.freeze({register,list,idForLink});
}
