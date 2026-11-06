/**
 * Read-only, address-specific V2 reorder suggestion.
 * Source of truth: a confirmed V2 order reconciled against the CURRENT
 * canonical invoice. No quote prices, payment state or invoice data is copied.
 */
const isSku=s=>/^TP-[0-9]{5}$/.test(String(s||''));
const normalizeUnit=x=>String(x||'').normalize('NFD')
 .replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().trim();
const invoiceKey=x=>String(x.invoiceNo)+'|'+String(x.ledgerId);

export function selectLatestReorderSuggestion(rows,currentInvoices,catalogue){
 if(!Array.isArray(rows)||!(currentInvoices instanceof Map)||
    !Array.isArray(catalogue))return null;
 const active=new Map(catalogue.filter(p=>p?.active===true&&isSku(p.code))
  .map(p=>[p.code,p]));
 for(const row of rows){
  if(row?.state!=='COMMITTED'||!Number.isSafeInteger(Number(row.invoiceNo))||
     Number(row.invoiceNo)<1||!row.ledgerId)continue;
  const current=currentInvoices.get(invoiceKey(row));
  if(!current||current.missing||current.excluded===true||
     /(?:hủy|huỷ|không tính|cancel)/iu.test(String(current.status||'')))continue;
  if(!Array.isArray(current.items)||!current.items.length||current.items.length>40)continue;
  const quantities=new Map();
  let valid=true;
  for(const line of current.items){
   const code=line?.code,product=active.get(code),qty=line?.qty;
   if(!product||!Number.isSafeInteger(qty)||qty<1||qty>500||
      (line.unit&&normalizeUnit(line.unit)!==normalizeUnit(product.unit))){
    valid=false;break;
   }
   const next=(quantities.get(code)||0)+qty;
   if(next>500){valid=false;break}
   quantities.set(code,next);
  }
  const total=[...quantities.values()].reduce((sum,n)=>sum+n,0);
  if(!valid||total>500)continue;
  const when=new Date(row.orderedAt);
  if(!Number.isFinite(when.getTime()))continue;
  return {
   orderedAt:when.toISOString(),
   items:[...quantities].map(([code,qty])=>({
    code,qty,name:String(active.get(code).name||code).slice(0,160),
    unit:String(active.get(code).unit||'').slice(0,40)
   }))
  };
 }
 return null;
}
