/*
 * Canonical catalogue verification for V2 staging.
 * Never trusts browser-supplied prices and never reads PII from the legacy ledger.
 */
import {DomainError,isSku,isMoney} from './domain.mjs';
const deny=code=>{throw new DomainError(code)};
export function validateCanonicalCatalogue(packet){
 if(!packet||!Number.isSafeInteger(packet.revision)||packet.revision<1)
  deny('CATALOGUE_REVISION_INVALID');
 const data=packet.data;
 if(data?.source!=='drive-ledger:satori_catalogue_v15'||data.revision!==packet.revision)
  deny('CATALOGUE_SOURCE_UNTRUSTED');
 if(!Array.isArray(data.products)||!data.products.length||data.products.length>200)
  deny('CATALOGUE_SIZE_INVALID');
 const used=new Set();
 const products=data.products.map(p=>{
  if(!p||!isSku(p.code)||used.has(p.code)||typeof p.name!=='string'||
     p.name.trim().length<2||p.name.length>180||
     typeof p.unit!=='string'||!p.unit.trim()||p.unit.length>40||
     !isMoney(p.listPrice))deny('CATALOGUE_PRODUCT_INVALID');
  used.add(p.code);
  return Object.freeze({code:p.code,name:p.name.trim(),unit:p.unit.trim(),
   listPrice:p.listPrice,revision:packet.revision,active:true});
 });
 return Object.freeze({revision:packet.revision,products:Object.freeze(products)});
}
