/** Versioned TEST-ONLY data export/import. Never touches Drive or production. */
import crypto from 'node:crypto';
import {productFor} from './catalogue.mjs';
import {MAX_LINES,MAX_UNITS} from './unified-draft.mjs';
const FORMAT='minh-satori-sandbox-backup';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x),'utf8').digest('hex');
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=()=>{throw new Error('INVALID_SANDBOX_BACKUP')};
export function createSandboxBackup({profiles,changeRequests,orders,drafts=[],phrases=[]}){
 const snapshot={format:FORMAT,version:1,exportedAt:new Date().toISOString(),sandbox:true,profiles,changeRequests,orders,drafts,phrases};
 return {ok:true,sandbox:true,snapshot,checksum:digest(snapshot)};
}
export function verifySandboxBackup(archive){
 if(!isObj(archive)||!isObj(archive.snapshot)||typeof archive.checksum!=='string')fail();
 const s=archive.snapshot,raw=JSON.stringify(s);
 if(raw.length>1_500_000||!/^([a-f0-9]{64})$/.test(archive.checksum)||!crypto.timingSafeEqual(Buffer.from(digest(s)),Buffer.from(archive.checksum)))fail();
 if(s.format!==FORMAT||s.version!==1||s.sandbox!==true||!Array.isArray(s.profiles)||!Array.isArray(s.changeRequests)||!Array.isArray(s.orders))fail();
 if(s.profiles.length>250||s.changeRequests.length>500||s.orders.length>1000)fail();
 const ids=new Set(['KH-DEMO-A','KH-DEMO-B']),refs=new Set();
 for(const p of s.profiles){
  if(!isObj(p)||!/^KH-SANDBOX-[a-f0-9-]{36}$/.test(p.id)||ids.has(p.id)||!/^([a-f0-9]{64})$/.test(p.tokenHash))fail();
  if(typeof p.name!=='string'||p.name.length<2||p.name.length>120||typeof p.address!=='string'||p.address.length<5||p.address.length>300||typeof p.phone!=='string'||p.phone.length>30)fail();
  if(!Number.isInteger(p.discount)||p.discount<0||p.discount>70||!Number.isInteger(p.ship)||p.ship<0||p.ship>30||![0,5,8,10].includes(p.vatRate??0)||typeof p.enabled!=='boolean')fail();
  ids.add(p.id);
 }
 for(const o of s.orders){
  if(!isObj(o)||o.sandbox!==true||typeof o.ref!=='string'||!/^TEST-[A-Z0-9-]{6,55}$/.test(o.ref)||refs.has(o.ref)||!ids.has(o.profileId)||Object.hasOwn(o,'token'))fail();
  if(typeof o.requestId!=='string'||!o.requestId.startsWith(o.profileId+'|'))fail();
  const suffix=o.requestId.slice(o.profileId.length+1);
  if(!/^[a-z0-9-]{8,80}$/i.test(suffix))fail();
  for(const key of ['subtotal','shipping','vatAmount','total']){
   if(!Number.isSafeInteger(o[key]??0)||(o[key]??0)<0||(o[key]??0)>1_000_000_000)fail();
  }
  if(o.total!==o.subtotal+o.shipping+(o.vatAmount??0))fail();
  if(Array.isArray(o.items)&&o.items.length>6)fail();
  refs.add(o.ref);
 }

 // v1 archives created before cross-device draft sync lack this optional field.
 // New archives include only hashed draft identifiers, never raw link credentials.
 const drafts=s.drafts===undefined?[]:s.drafts;
 if(!Array.isArray(drafts)||drafts.length>250)fail();
 const keys=new Set();
 for(const d of drafts){
  if(!isObj(d)||Object.hasOwn(d,'token')||!/^([a-f0-9]{64})$/.test(d.key)||
     keys.has(d.key)||!Number.isSafeInteger(d.revision)||d.revision<1||
     !Number.isSafeInteger(d.updatedAt)||d.updatedAt<1||
     d.updatedAt>Date.now()+60_000||!Array.isArray(d.items)||d.items.length>MAX_LINES)fail();
  keys.add(d.key);
  const codes=new Set();let units=0;
  for(const item of d.items){
   if(!isObj(item)||typeof item.code!=='string'||!productFor(item.code)||
      productFor(item.code).code!==item.code||codes.has(item.code)||
      !Number.isSafeInteger(item.qty)||item.qty<1||item.qty>MAX_UNITS)fail();
   units+=item.qty;codes.add(item.code);
  }
  if(units>MAX_UNITS)fail();
 }
 const phrases=s.phrases===undefined?[]:s.phrases;
 if(!Array.isArray(phrases)||phrases.length>1500)fail();
 const seenPhrases=new Set(),counts=new Map();
 for(const p of phrases){
  if(!isObj(p)||Object.hasOwn(p,'token')||!/^([a-f0-9]{64})$/.test(p.key)||
     typeof p.alias!=='string'||!/^[a-z0-9 ]{4,42}$/.test(p.alias)||
     typeof p.code!=='string'||!productFor(p.code)||productFor(p.code).code!==p.code||
     !Number.isSafeInteger(p.updatedAt)||p.updatedAt<1||p.updatedAt>Date.now()+60000)fail();
  const id=p.key+'|'+p.alias;
  if(seenPhrases.has(id))fail();
  seenPhrases.add(id);
  counts.set(p.key,(counts.get(p.key)||0)+1);
  if(counts.get(p.key)>20)fail();
 }
 for(const r of s.changeRequests){
  if(!isObj(r)||typeof r.id!=='string'||r.id.length>80||!ids.has(r.profileId)||!['pending','reviewed'].includes(r.status)||typeof r.message!=='string'||r.message.length>500)fail();
 }
 return {profiles:structuredClone(s.profiles),changeRequests:structuredClone(s.changeRequests),orders:structuredClone(s.orders),drafts:structuredClone(drafts),phrases:structuredClone(phrases)};
}
