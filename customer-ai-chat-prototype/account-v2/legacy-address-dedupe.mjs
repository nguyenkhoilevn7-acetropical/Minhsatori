/**
 * Canonical V2 display grouping for owner-bound historical delivery addresses.
 * This groups LOCATION records, never customers or account identities.
 * Invoice IDs remain separate and immutable.
 */
export function normalizedDeliveryAddress(value){
 return String(value||'').normalize('NFKC').trim()
  .toLocaleLowerCase('vi-VN').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d')
  .replace(/[.,;:]/g,' ').replace(/\s+/g,' ').trim();
}

function timeOf(value){
 if(typeof value==='number'&&Number.isFinite(value)){
  const ms=value<1e11?value*1000:value;
  return ms>=946684800000&&ms<=4102444800000?ms:null;
 }
 if(typeof value!=='string'||!value.trim())return null;
 const v=value.trim();
 if(/^\d{10,13}$/.test(v))return timeOf(Number(v));
 // Historical invoices may use D/M/YYYY or YYYY-MM-DD date strings.
 const vi=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
 if(vi){
  const day=+vi[1],month=+vi[2],year=+vi[3],hour=+(vi[4]||0),min=+(vi[5]||0),sec=+(vi[6]||0);
  const t=Date.UTC(year,month-1,day,hour,min,sec);
  const check=new Date(t);
  return year>=2000&&year<=2100&&check.getUTCFullYear()===year&&
   check.getUTCMonth()===month-1&&check.getUTCDate()===day&&
   hour<24&&min<60&&sec<60?t:null;
 }
 if(/^\d{4}-\d\d-\d\d(?:[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(v)){
  const ms=Date.parse(v);
  return Number.isFinite(ms)&&ms>=946684800000&&ms<=4102444800000?ms:null;
 }
 return null;
}

export function historicalInvoiceCreatedAt(row){
 // Prefer explicit source creation timestamp over invoice day or invoice number.
 for(const field of ['createdAt','created_at','timestamp','createdTime','date']){
  const t=timeOf(row?.[field]);if(t!==null)return t;
 }
 return null;
}

export function groupHistoricalAddresses(invoices){
 const groups=new Map();
 for(const row of invoices||[]){
  const key=normalizedDeliveryAddress(row?.address);
  if(!key)continue;
  const timestamp=historicalInvoiceCreatedAt(row);
  const previous=groups.get(key);
  const candidate={...row,normalizedAddress:key,_createdAt:timestamp};
  // Fallback invoice number is ONLY for identical source time; never used
  // to override a verified newer creation timestamp.
  const newer=!previous||
   (timestamp!==null&&previous._createdAt===null)||
   (timestamp!==null&&previous._createdAt!==null&&timestamp>previous._createdAt)||
   (timestamp===previous?._createdAt&&Number(row.invoiceNo)>Number(previous.invoiceNo));
  if(newer)groups.set(key,candidate);
 }
 return [...groups.values()].sort((a,b)=>(b._createdAt??-1)-(a._createdAt??-1))
  .map(({_createdAt,normalizedAddress,...row})=>({
   ...row,normalizedAddress,latestCreatedAt:_createdAt
  }));
}
