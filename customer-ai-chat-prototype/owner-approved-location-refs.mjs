/**
 * Parse owner-selected historical delivery sources without confusing an
 * invoice number with a row identity. Repeated purchases are NOT duplicates.
 *
 * Modern admin uses exact {id, invoiceNo} references, while the legacy admin
 * continues to submit invoice numbers. A source lookup and GAS validation must
 * still confirm the record and complete contact before owner approval.
 */
const fail=code=>{throw Object.assign(new Error(code),{code})};
const invoiceNo=n=>Number.isSafeInteger(n)&&n>0;
const validId=v=>(typeof v==='string'&&v.length>0&&v.length<=100)||
 (typeof v==='number'&&Number.isSafeInteger(v)&&v>=0);

export function ownerSelectedLocations(input){
 const exact=Array.isArray(input?.destinationRefs);
 const list=exact?input.destinationRefs:input?.destinationInvoiceNos;
 if(!Array.isArray(list)||list.length<1||list.length>20)
  fail('CTV_DESTINATIONS_INVALID');
 const refs=list.map(row=>{
  if(exact){
   if(!row||typeof row!=='object'||Array.isArray(row)||
      !validId(row.id)||!invoiceNo(row.invoiceNo))
    fail('CTV_DESTINATIONS_INVALID');
   return {id:row.id,invoiceNo:row.invoiceNo};
  }
  if(!invoiceNo(row))fail('CTV_DESTINATIONS_INVALID');
  return {id:null,invoiceNo:row};
 });
 const keys=refs.map(ref=>exact?String(ref.id)+'|'+ref.invoiceNo:String(ref.invoiceNo));
 if(new Set(keys).size!==refs.length)fail('CTV_DESTINATIONS_DUPLICATE');
 return {refs,exact};
}

export function selectedLocationEvidence(places){
 const candidate=[],needsReview=[];
 const assigned=new Set();
 for(const p of Array.isArray(places)?places:[]){
  if(!p||typeof p!=='object')continue;
  const refs=Array.isArray(p.references)?p.references:[];
  const preferred=refs.find(r=>r&&validId(r.id)&&invoiceNo(r.invoiceNo));
  const address=String(p.address||'').trim();
  const phone=String(p.phone||'').replace(/\\D/g,'');
  const key=preferred&&String(preferred.id)+'|'+preferred.invoiceNo;
  if(!preferred||address.length<5||phone.length<8||assigned.has(key)){
   needsReview.push({address,reason:!preferred?'MISSING_HISTORIC_REFERENCE':
    phone.length<8?'MISSING_PHONE':address.length<5?'MISSING_ADDRESS':'AMBIGUOUS_REFERENCE'});
   continue;
  }
  assigned.add(key);
  candidate.push({ref:{id:preferred.id,invoiceNo:preferred.invoiceNo},
   name:String(p.name||''),phone:String(p.phone||''),address,needsReview:!!p.needsReview});
 }
 return {candidate,needsReview};
}
