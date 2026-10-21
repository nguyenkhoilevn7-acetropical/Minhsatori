/** Customer-scoped delivery locations for the isolated Gemini sandbox.
 * Never infer a destination from ambiguous prose. This module has no production IO.
 */
export const MAX_LOCATIONS=20;
const clean=(x,max)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
export const foldLocation=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export function listLocations(profile){
 const saved=Array.isArray(profile?.locations)?profile.locations.filter(x=>x&&x.enabled!==false):[];
 if(saved.length)return saved.map(x=>({...x}));
 return [{id:'primary',label:'Địa chỉ chính',recipient:profile?.name||'',phone:profile?.phone||'',address:profile?.address||'',enabled:true}];
}
export function validateLocation(input){
 const label=clean(input?.label,80),recipient=clean(input?.recipient,120);
 const phone=clean(input?.phone,30),address=clean(input?.address,300);
 if(label.length<2||recipient.length<2||address.length<5||!/^\+?[\d\s().-]{8,30}$/.test(phone))return null;
 return {label,recipient,phone,address,enabled:true};
}
export function matchLocation(profile,message){
 const locations=listLocations(profile),spoken=foldLocation(message);
 if(!spoken||locations.length===1)return {status:locations.length===1?'single':'missing',location:locations.length===1?locations[0]:null};
 // Exact location labels are authoritative only if long enough and unique.
 const byLabel=locations.filter(x=>{const key=foldLocation(x.label);return key.length>=4&&new RegExp('(?:^| )'+key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?: |$)').test(spoken)});
 if(byLabel.length===1)return {status:'matched',location:byLabel[0],source:'label'};
 if(byLabel.length>1)return {status:'ambiguous',locations:byLabel};
 // Address matching requires the full (normalized) saved address, never just a district.
 const byAddress=locations.filter(x=>{const key=foldLocation(x.address);return key.length>=12&&spoken.includes(key)});
 if(byAddress.length===1)return {status:'matched',location:byAddress[0],source:'full-address'};
 if(byAddress.length>1)return {status:'ambiguous',locations:byAddress};
 return {status:'unresolved',locations};
}
export function chosenLocation(profile,id){
 return listLocations(profile).find(x=>x.id===id)||null;
}
