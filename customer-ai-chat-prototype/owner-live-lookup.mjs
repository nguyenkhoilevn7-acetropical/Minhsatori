/**
 * Owner-only production ledger lookup. This module never handles credentials
 * and cannot perform any write action. Browser/customer routes must never use it.
 */
const fail=(code)=>{const error=new Error(code);error.code=code;throw error};
const datePattern=/^20\d{2}-(0[1-9]|1[0-2])$/;
const clean=(v,max)=>String(v||'').trim().slice(0,max);
export function ownerLiveLookup(params){
 const kind=params.get('kind');
 if(kind==='invoices'){
  const query=clean(params.get('query'),120);
  const month=clean(params.get('month'),7);
  if(!query && !month)fail('LIVE_QUERY_REQUIRED');
  if(query && query.length<2)fail('LIVE_QUERY_TOO_SHORT');
  if(month&&!datePattern.test(month))fail('LIVE_MONTH_INVALID');
  const payload={limit:100};
  if(query)payload.query=query;
  if(month){
   const [y,m]=month.split('-').map(Number);
   const last=new Date(Date.UTC(y,m,0)).getUTCDate();
   payload.from=month+'-01';payload.to=month+'-'+String(last).padStart(2,'0');
  }
  return {kind,action:'orders.list',payload};
 }
 if(kind==='customers'){
  const query=clean(params.get('query'),120);
  const phone=String(params.get('phone')||'').replace(/\D/g,'').slice(0,20);
  if(query.length<2&&phone.length<7)fail('LIVE_CUSTOMER_QUERY_REQUIRED');
  return {kind,action:'customers.search',payload:{...(query?{query}:{}),...(phone?{phone}:{}),limit:20}};
 }
 fail('LIVE_LOOKUP_UNSUPPORTED');
}
