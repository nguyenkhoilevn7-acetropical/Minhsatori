/**
 * Accent/case-insensitive, partial-match ranking for the Grok owner connector.
 * Pure helpers plus one read-only collector over the signed orders.list action.
 * Nothing here renames, merges or writes a customer: it only ranks rows the
 * ledger already returned.
 */

/** Same normalisation as BotApi norm(): accent/case-insensitive identity. */
export const norm=v=>String(v==null?'':v).normalize('NFD').replace(/[̀-ͯ]/g,'')
 .replace(/đ/g,'d').replace(/Đ/g,'d').toLowerCase().replace(/\btreky\b/g,'traky').trim();
export const digitsOnly=v=>String(v||'').replace(/\D/g,'');
const words=v=>norm(v).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * 0..100. 100 exact, 92 prefix, 85 substring, 75 substring ignoring spaces,
 * 60..80 every query word found (whole word or word prefix), <=50 partial.
 */
export function matchScore(text,query){
 const t=norm(text),q=norm(query);
 if(!t||!q)return 0;
 if(t===q)return 100;
 if(t.startsWith(q))return 92;
 if(t.includes(q))return 85;
 const tw=words(t),qw=words(q);
 if(!qw.length)return 0;
 if(qw.join('').length>=4&&tw.join('').includes(qw.join('')))return 75;
 let whole=0,partial=0;
 for(const w of qw){
  if(tw.includes(w))whole++;
  else if(tw.some(x=>x.startsWith(w)||(w.length>=3&&x.includes(w))))partial++;
 }
 if(whole+partial===qw.length)return 60+Math.round(20*whole/qw.length);
 const ratio=(whole+0.6*partial)/qw.length;
 return ratio>=0.5?Math.round(50*ratio):0;
}

/** Score of one ledger row against the owner's text (name, phone, invoice number, address). */
export function rowScore(row,query){
 const q=String(query||'').trim(),d=digitsOnly(q);
 let s=matchScore(row?.name,q);
 if(d.length>=5&&digitsOnly(row?.phone).includes(d))s=Math.max(s,95);
 if(/^\d{1,12}$/.test(q)&&Number(row?.invoiceNo)===Number(q))s=Math.max(s,100);
 s=Math.max(s,Math.round(matchScore(row?.location,q)*0.6));
 return s;
}

/** Terms sent to the ledger's substring search so "minh hoa" still finds "Minh Thị Hoa". */
export function upstreamTerms(query){
 const q=String(query||'').trim(),d=digitsOnly(q);
 if(d.length>=5&&d.length===q.replace(/[\s.+()-]/g,'').length)return [d];
 const ws=[...new Set(words(q))].filter(w=>w.length>=2).sort((a,b)=>b.length-a.length).slice(0,3);
 const out=[q];
 for(const w of ws)if(!out.some(x=>norm(x)===w))out.push(w);
 return out.slice(0,4);
}

const fail=(code,message)=>{const e=new Error(message);e.code=code;e.grok=true;throw e};

/**
 * Read-only: orders.list for every upstream term, merged by (id, invoiceNo).
 * range = {from,to} in YYYY-MM-DD (optional; a query is always present).
 */
export async function collectOrders(reader,query,range={}){
 const seen=new Map();let truncated=false,revision=null;
 for(const term of upstreamTerms(query)){
  const r=await reader('orders.list',{query:term,limit:100,...range});
  if(!Number.isSafeInteger(r?.revision)||!Array.isArray(r?.data?.orders))
   fail('LEDGER_UNAVAILABLE','Chưa đọc được sổ Minh Satori, thử lại sau.');
  revision=r.revision;
  if(r.data.orders.length>=100||(Number.isSafeInteger(r.data.totalMatches)&&r.data.totalMatches>r.data.orders.length))truncated=true;
  for(const o of r.data.orders){
   const no=Number(o?.invoiceNo);
   if(!Number.isSafeInteger(no)||no<=0||o?.id==null)continue;
   seen.set(String(o.id)+'|'+no,o);
  }
 }
 return {revision,truncated,rows:[...seen.values()]};
}
