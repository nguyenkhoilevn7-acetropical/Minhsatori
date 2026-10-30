/*
 * V2 invoice list search: validate optional local dates and recipient name.
 * Keep the entire filter inside the authenticated account's quote/order scope.
 */
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const invalid=()=>{const e=new Error('INVOICE_FILTER_INVALID');e.code='INVOICE_FILTER_INVALID';throw e;};
function date(value){
 if(value===null||value==='')return null;
 if(typeof value!=='string'||!datePattern.test(value))invalid();
 const d=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==value)invalid();
 const year=Number(value.slice(0,4));
 if(year<2000||year>2100)invalid();
 return value;
}
export function invoiceOrderFilters(searchParams){
 const pick=key=>{
  if(searchParams.getAll(key).length>1)invalid();
  return searchParams.get(key);
 };
 const from=date(pick('from')),to=date(pick('to'));
 if(from&&to&&from>to)invalid();
 const raw=pick('customer');
 if(raw!==null&&(typeof raw!=='string'||raw.length>120||/[\u0000-\u001f\u007f]/u.test(raw)))invalid();
 const customer=(raw||'').trim().normalize('NFC');
 if(customer.length>100)invalid();
 const toExclusive=to?new Date(Date.parse(to+'T00:00:00.000Z')+86400000).toISOString().slice(0,10):null;
 return Object.freeze({from,to,toExclusive,customer:customer||null});
}
