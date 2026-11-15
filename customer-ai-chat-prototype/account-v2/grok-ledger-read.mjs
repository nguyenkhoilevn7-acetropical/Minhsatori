/**
 * Grok owner connector: READ-ONLY ledger tools, parity with the ChatGPT
 * connector (system_status, orders_list, orders_get, orders_audit_history,
 * orders_preview_update, debt_summary, products_search, invoice_pdf) plus
 * per-customer debt and a debt statement PDF.
 *
 * Every call goes through the signed read transport (satori-readonly.mjs) to
 * the SAME Apps Script actions the ChatGPT connector uses, so numbers match by
 * construction (debt totals come from debt.summary itself). Nothing here
 * writes the ledger or PostgreSQL. No customer data or secrets are logged.
 */
import crypto from 'node:crypto';
import {GrokOrderError,findCustomers} from './grok-orders.mjs';
import {norm,collectOrders,rowScore,matchScore} from './grok-search.mjs';
import {signFileLink,verifyFileToken,absoluteUrl,GROK_FILE_PREFIX} from './grok-files.mjs';
import {renderDebtStatementPdf} from './grok-debt-pdf.mjs';

const bad=(code,message)=>{throw new GrokOrderError(code,message)};
const need=(ok,code,message)=>{if(!ok)bad(code,message)};
export const vnd=n=>Number(n).toLocaleString('vi-VN')+' đ';
const MAX_EMBED_BYTES=1_500_000;

/* ---------- dates (Asia/Ho_Chi_Minh business day) ---------- */
export const vnToday=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export const addDays=(iso,n)=>new Date(Date.parse(iso+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const validIso=x=>/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(x||''))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
/** Ledger dates are dd/MM/yyyy (BotApi iso()); ISO passes through. */
export function ledgerIso(d){
 const m=String(d||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if(!m)return validIso(String(d||'').slice(0,10))?String(d).slice(0,10):'';
 const iso=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
 return validIso(iso)?iso:'';
}
/** {days} -> last N days ending today; {from,to} explicit; neither -> default (or null = all time). */
export function resolveRange(args={},{defaultDays=30,now=Date.now()}={}){
 if(args.from!=null||args.to!=null){
  need(validIso(args.from)&&validIso(args.to)&&args.from<=args.to,'INVALID_RANGE','from/to phải dạng YYYY-MM-DD và from ≤ to.');
  const days=Math.round((Date.parse(args.to)-Date.parse(args.from))/86400000)+1;
  need(days<=366,'INVALID_RANGE','Khoảng ngày tối đa 366 ngày.');
  return {from:args.from,to:args.to,days};
 }
 const d=args.days??defaultDays;
 if(d==null)return null;
 need(Number.isSafeInteger(d)&&d>=1&&d<=366,'INVALID_RANGE','days phải là số nguyên 1-366.');
 const to=vnToday(now);
 return {from:addDays(to,-(d-1)),to,days:d};
}

/* ---------- exact decimal money (hundredths as BigInt) ---------- */
function decToCents(s){
 const neg=s.startsWith('-'),[i,f='']=s.replace('-','').split('.');
 let c=BigInt(i)*100n+BigInt((f+'00').slice(0,2));
 if(f.length>2&&Number(f[2])>=5)c+=1n;
 return neg?-c:c;
}
export function toCents(v){
 if(v==null||v==='')return 0n;
 if(typeof v==='bigint')return v*100n;
 if(typeof v==='number'){
  need(Number.isFinite(v),'INVALID_AMOUNT','Số tiền trong sổ không hợp lệ.');
  const s=String(v);
  return /e/i.test(s)?BigInt(Math.round(v*100)):decToCents(s);
 }
 const s=String(v).trim();
 need(/^-?\d+(\.\d+)?$/.test(s),'INVALID_AMOUNT','Số tiền trong sổ không hợp lệ.');
 return decToCents(s);
}
export const fromCents=c=>c%100n===0n?Number(c/100n):Number(c)/100;
const sumCents=list=>list.reduce((n,x)=>n+x,0n);

/* ---------- signed reads ---------- */
const OWNER_SCOPED=new Set(['debt.summary','orders.auditHistory','orders.previewUpdate','orders.get','trash.list']);
async function read(reader,action,payload){
 let r;
 try{r=await reader(action,payload)}
 catch(e){
  if(e instanceof GrokOrderError)throw e;
  if(OWNER_SCOPED.has(action)&&/UPSTREAM_ERROR|ACTION_DENIED/.test(String(e?.message||'')))
   bad('LEDGER_SCOPE_MISSING','Khóa đọc V2 chưa được cấp quyền '+action+' trong Apps Script (chủ cửa hàng cần cấp). Chưa đọc được dữ liệu.');
  bad('LEDGER_UNAVAILABLE','Chưa đọc được sổ Minh Satori, thử lại sau.');
 }
 need(Number.isSafeInteger(r?.revision)&&r?.data&&typeof r.data==='object','LEDGER_UNAVAILABLE','Chưa đọc được sổ Minh Satori, thử lại sau.');
 return r;
}
export const isActive=o=>!['Đã hủy','Không Tính'].includes(String(o?.status||''));
const isPaid=o=>isActive(o)&&o?.customerPaid===true;

export function brief(o){
 return {invoiceNo:Number(o.invoiceNo),ledgerId:String(o.id),date:ledgerIso(o.date)||String(o.date||''),
  name:String(o.name||''),phone:String(o.phone||''),location:String(o.location||''),
  total:fromCents(toCents(o.total)),
  // App rule: "Đã hủy"/"Không Tính" count as 0 đ in debt, bill totals and revenue; total stays the original.
  effectiveTotal:isActive(o)?fromCents(toCents(o.total)):0,status:String(o.status||''),
  customerPaid:isPaid(o),satoriPaid:isActive(o)&&o?.satoriPaid===true,cancelled:!isActive(o),
  itemCount:Array.isArray(o.items)?o.items.length:0};
}

/** Ledger id from a Grok draft or PDF delivery row -> invoice number (read-only). */
async function invoiceNoForLedgerId(pool,ledgerId){
 if(!pool||!/^[A-Za-z0-9_-]{1,80}$/.test(ledgerId))return null;
 for(const sql of ['SELECT invoice_no FROM satori_v2_grok_order_drafts WHERE ledger_id=$1 AND invoice_no IS NOT NULL LIMIT 1',
  'SELECT invoice_no FROM satori_v2_owner_pdf_deliveries WHERE ledger_id=$1 LIMIT 1']){
  try{const r=await pool.query(sql,[ledgerId]);if(r.rows.length)return Number(r.rows[0].invoice_no)}catch{}
 }
 return null;
}

/** Exactly one ledger row by invoice number (and ledger id when given). Never fuzzy. */
export async function exactOrder(reader,{invoiceNo,orderId}={},pool=null){
 let n=invoiceNo;
 const idText=orderId==null?'':String(orderId).trim();
 if(n==null&&/^\d{1,12}$/.test(idText))n=Number(idText);
 const ledgerId=n!=null&&/^\d{1,12}$/.test(idText)&&Number(idText)===n?'':idText;
 if(n==null&&ledgerId)n=await invoiceNoForLedgerId(pool,ledgerId);
 need(Number.isSafeInteger(n)&&n>0,'INVALID_ORDER','Cần số hóa đơn (ví dụ 6123).');
 const r=await read(reader,'orders.list',{query:String(n),limit:100});
 const rows=Array.isArray(r.data.orders)?r.data.orders:[];
 const exact=rows.filter(o=>Number(o?.invoiceNo)===n&&(!ledgerId||String(o?.id)===ledgerId));
 need(exact.length>=1,'ORDER_NOT_FOUND','Không tìm thấy hóa đơn #'+n+' trong sổ (có thể đã xóa vào thùng rác).');
 need(exact.length===1,'ORDER_AMBIGUOUS','Số hóa đơn #'+n+' không duy nhất; cần thêm orderId (ledgerId).');
 return {revision:r.revision,order:exact[0]};
}

/**
 * Exactly one trash-bin entry (the app's 30-day Thùng Rác, BotApi trash.list).
 * Returns {revision, order, deletedAt, expiresAt}.
 */
export async function trashEntry(reader,{invoiceNo,orderId}={}){
 let n=invoiceNo;
 const idText=orderId==null?'':String(orderId).trim();
 if(n==null&&/^\d{1,12}$/.test(idText))n=Number(idText);
 const ledgerId=/^\d{1,12}$/.test(idText)&&Number(idText)===n?'':idText;
 need(Number.isSafeInteger(n)&&n>0,'INVALID_ORDER','Cần số hóa đơn (ví dụ 6123).');
 const r=await read(reader,'trash.list',{query:String(n),limit:30});
 const list=Array.isArray(r.data.invoices)?r.data.invoices:[];
 const hits=list.filter(t=>Number(t?.order?.invoiceNo)===n&&(!ledgerId||String(t.order.id)===ledgerId));
 need(hits.length>=1,'TRASH_NOT_FOUND','Không thấy hóa đơn #'+n+' trong Thùng Rác (chỉ giữ 30 ngày).');
 need(hits.length===1,'TRASH_AMBIGUOUS','Thùng Rác có nhiều hóa đơn #'+n+'; cần orderId (ledgerId).');
 const t=hits[0];
 need(!Number.isFinite(t.expiresAt)||t.expiresAt>Date.now(),'TRASH_EXPIRED','Hóa đơn #'+n+' đã quá hạn khôi phục 30 ngày.');
 return {revision:r.revision,order:t.order,deletedAt:t.deletedAt??null,expiresAt:t.expiresAt??null};
}

export async function trashList(reader,args={}){
 const q=String(args.query||'').trim();
 need(q.length>=1&&q.length<=80,'INVALID_QUERY','Nhập số hóa đơn, tên hoặc số điện thoại (1-80 ký tự).');
 const r=await read(reader,'trash.list',{query:q,limit:30});
 const list=Array.isArray(r.data.invoices)?r.data.invoices:[];
 return {count:list.length,totalMatches:r.data.totalMatches??list.length,source:'trash.list (Thùng Rác 30 ngày)',
  invoices:list.map(t=>({...brief(t.order),effectiveTotal:0,inTrash:true,
   deletedAt:Number.isFinite(t.deletedAt)?new Date(t.deletedAt).toISOString():null,
   restorableUntil:Number.isFinite(t.expiresAt)?new Date(t.expiresAt).toISOString():null})),
  note:'Hóa đơn trong Thùng Rác không nằm trong danh sách và công nợ (giống app). Khôi phục: satori_order_restore_request.'};
}

/* ---------- customers ---------- */
/**
 * Picks ONE customer name from fuzzy text, or returns candidates to ask.
 * Never merges different names. customerRef = newest invoice of that name.
 */
export async function resolveCustomer(reader,args,pool=null){
 if(args.customerRef!=null){
  const ref=args.customerRef;
  need(ref&&Number.isSafeInteger(ref.invoiceNo),'INVALID_CUSTOMER_REF','customerRef không hợp lệ.');
  const {order}=await exactOrder(reader,{invoiceNo:ref.invoiceNo,orderId:ref.id==null?undefined:String(ref.id)},pool);
  return {name:String(order.name||''),customerRef:{id:String(order.id),invoiceNo:Number(order.invoiceNo)},score:100};
 }
 const q=String(args.customer||'').trim();
 need(q.length>=2&&q.length<=80,'INVALID_QUERY','Nhập tên khách (2-80 ký tự) hoặc customerRef.');
 const {rows}=await collectOrders(reader,q);
 const byName=new Map();
 for(const o of rows){
  const s=rowScore(o,q);if(s<50)continue;
  const key=norm(o.name);if(!key)continue;
  const cur=byName.get(key)||{name:String(o.name||''),score:0,invoiceCount:0,locations:new Set(),customerRef:null};
  cur.score=Math.max(cur.score,s);cur.invoiceCount++;
  if(o.location)cur.locations.add(String(o.location));
  if(!cur.customerRef||Number(o.invoiceNo)>cur.customerRef.invoiceNo){
   cur.customerRef={id:String(o.id),invoiceNo:Number(o.invoiceNo)};cur.name=String(o.name||'');
  }
  byName.set(key,cur);
 }
 const list=[...byName.values()].sort((a,b)=>b.score-a.score||b.invoiceCount-a.invoiceCount);
 need(list.length>0,'CUSTOMER_NOT_FOUND','Không tìm thấy khách khớp "'+q.slice(0,40)+'".');
 const [top,second]=list;
 if(!second||(top.score===100&&second.score<100)||top.score-second.score>=15)
  return {name:top.name,customerRef:top.customerRef,score:top.score};
 return {needsSelection:true,candidates:list.slice(0,8).map(c=>({name:c.name,matchScore:c.score,
  invoiceCount:c.invoiceCount,locations:[...c.locations].slice(0,3),customerRef:c.customerRef}))};
}
const selectionReply=sel=>({ok:false,state:'NEEDS_SELECTION',candidates:sel.candidates,
 message:'Có nhiều khách gần giống. Hỏi chủ cửa hàng chọn đúng khách rồi gọi lại với customerRef của khách đó. Không tự gộp hay đổi tên khách.'});

/* ---------- debt ---------- */
function debtData(r){
 const d=r.data;
 need(Number.isSafeInteger(d.orders)&&Array.isArray(d.unpaidInvoices),'LEDGER_UNAVAILABLE','Dữ liệu công nợ không hợp lệ.');
 return d;
}

export async function debtSummary(reader,args={},now=Date.now()){
 const range=resolveRange(args,{defaultDays:null,now});
 const r=await read(reader,'debt.summary',range?{from:range.from,to:range.to}:{});
 const d=debtData(r);
 const groups=new Map();
 for(const o of d.unpaidInvoices){
  const key=norm(o.name);
  const g=groups.get(key)||{name:String(o.name||''),invoices:0,owedCents:0n,oldestDate:null};
  g.invoices++;g.owedCents+=toCents(o.total);
  const iso=ledgerIso(o.date);if(iso&&(!g.oldestDate||iso<g.oldestDate))g.oldestDate=iso;
  groups.set(key,g);
 }
 const top=[...groups.values()].sort((a,b)=>(b.owedCents>a.owedCents?1:b.owedCents<a.owedCents?-1:0)).slice(0,10)
  .map(g=>({name:g.name,unpaidInvoices:g.invoices,owed:fromCents(g.owedCents),owedText:vnd(fromCents(g.owedCents)),oldestUnpaidDate:g.oldestDate}));
 const due=fromCents(toCents(d.due)),total=fromCents(toCents(d.total));
 return {source:'debt.summary',ledgerRevision:r.revision,range:range||'ALL_TIME',
  invoiceCount:d.orders,unpaidCount:d.unpaidCount,totalBilled:total,totalDue:due,totalDueText:vnd(due),
  excludedReferenceCount:d.excludedReferenceCount??0,reviewCount:d.reviewCount??0,
  topCustomers:top,topCustomersPartial:!!d.truncated,
  note:'Cùng nguồn debt.summary với ChatGPT. Đơn Đã hủy/Không Tính không tính nợ. "Đã TT Satori" không có nghĩa khách đã trả.'+
   (d.truncated?' Sổ trả tối đa 100 hóa đơn chưa trả: top khách có thể thiếu, tổng nợ vẫn đúng.':'')};
}

/** Per-invoice debt of one customer name in [from,to]. Owed amounts reconcile with debt.summary. */
export async function customerDebtRows(reader,customer,range){
 const key=norm(customer.name);
 const debt=debtData(await read(reader,'debt.summary',{query:customer.name,from:range.from,to:range.to}));
 const list=await read(reader,'orders.list',{query:customer.name,from:range.from,to:range.to,limit:100});
 const all=Array.isArray(list.data.orders)?list.data.orders:[];
 const listTruncated=all.length>=100||(Number.isSafeInteger(list.data.totalMatches)&&list.data.totalMatches>all.length);
 const ledgerUnpaid=debt.unpaidInvoices.filter(o=>norm(o.name)===key);
 const unpaidSet=new Set(ledgerUnpaid.map(o=>String(o.id)+'|'+Number(o.invoiceNo)));
 const mine=all.filter(o=>norm(o.name)===key).sort((a,b)=>
  (ledgerIso(a.date)||'').localeCompare(ledgerIso(b.date)||'')||Number(a.invoiceNo)-Number(b.invoiceNo));
 const rows=[],excluded=[];let cum=0n;const t={total:0n,paid:0n,owed:0n};
 for(const o of mine){
  const base={invoiceNo:Number(o.invoiceNo),ledgerId:String(o.id),date:ledgerIso(o.date)||String(o.date||''),status:String(o.status||'')};
  if(!isActive(o)){excluded.push({...base,originalTotal:fromCents(toCents(o.total)),effectiveTotal:0,
   reason:'Đã hủy / Không tính: tính 0 đ, không thuộc công nợ'});continue}
  const paid=isPaid(o),counted=paid||unpaidSet.has(String(o.id)+'|'+Number(o.invoiceNo))||debt.truncated;
  if(!counted){excluded.push({...base,reason:'Hóa đơn tham chiếu (cặp CTV): sổ không tính vào công nợ'});continue}
  const total=toCents(o.total),paidC=paid?total:0n,owed=total-paidC;
  cum+=owed;t.total+=total;t.paid+=paidC;t.owed+=owed;
  rows.push({...base,name:String(o.name||''),location:String(o.location||''),
   total:fromCents(total),paid:fromCents(paidC),owed:fromCents(owed),cumulative:fromCents(cum)});
 }
 const ledgerOwed=sumCents(ledgerUnpaid.map(o=>toCents(o.total)));
 return {rows,excluded,totals:{total:fromCents(t.total),paid:fromCents(t.paid),owed:fromCents(t.owed)},
  reconciled:!debt.truncated&&!listTruncated&&ledgerOwed===t.owed,
  ledgerOwed:fromCents(ledgerOwed),truncated:!!debt.truncated||listTruncated};
}

export async function customerDebt(reader,args={},pool=null,now=Date.now()){
 const range=resolveRange(args,{defaultDays:30,now});
 const c=await resolveCustomer(reader,args,pool);
 if(c.needsSelection)return selectionReply(c);
 const d=await customerDebtRows(reader,c,range);
 return {customer:{name:c.name,customerRef:c.customerRef},range,
  invoices:d.rows,excluded:d.excluded,totals:{...d.totals,owedText:vnd(d.totals.owed)},
  reconciledWithDebtSummary:d.reconciled,
  note:'"Đã trả" là khách đã trả đủ hóa đơn (sổ chỉ ghi trả đủ/chưa trả, không có trả một phần). '+
   (d.reconciled?'Số còn nợ khớp debt.summary.':'CẢNH BÁO: vượt 100 hóa đơn hoặc lệch debt.summary ('+vnd(d.ledgerOwed)+'); thu hẹp số ngày.')};
}

/* ---------- PDF helpers ---------- */
function attach(kind,name,bytes){
 if(bytes.length>MAX_EMBED_BYTES)return [];
 return [{type:'resource',resource:{uri:'satori-file://'+kind+'/'+encodeURIComponent(name),
  mimeType:'application/pdf',blob:bytes.toString('base64')}}];
}
async function defaultInvoicePdf(ref,reader){
 const {prepareOwnerPdfDownload}=await import('./owner-pdf-delivery.mjs');
 const {exactCurrentInvoiceFromOrdersList}=await import('./local-invoice-read.mjs');
 const out=await prepareOwnerPdfDownload(ref,{read:x=>exactCurrentInvoiceFromOrdersList(x,{reader})});
 return {bytes:out.bytes,sha256:out.sha256,filename:out.filename};
}
const slug=v=>norm(v).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'khach';

async function buildStatement(reader,{customerRef,days,to},pool){
 const range={from:addDays(to,-(days-1)),to,days};
 if(customerRef){
  const c=await resolveCustomer(reader,{customerRef},pool);
  const d=await customerDebtRows(reader,c,range);
  const notes=d.reconciled?[]:['Vượt giới hạn 100 hóa đơn hoặc chưa khớp debt.summary: thu hẹp số ngày để có bảng đầy đủ.'];
  return {customerName:c.name,from:range.from,to:range.to,days,rows:d.rows,totals:d.totals,notes,
   fileName:'Cong-no-'+slug(c.name)+'-'+range.to+'.pdf'};
 }
 const d=debtData(await read(reader,'debt.summary',{from:range.from,to:range.to}));
 const sorted=[...d.unpaidInvoices].sort((a,b)=>(ledgerIso(a.date)||'').localeCompare(ledgerIso(b.date)||'')||Number(a.invoiceNo)-Number(b.invoiceNo));
 let cum=0n;
 const rows=sorted.map(o=>{const t=toCents(o.total);cum+=t;return {invoiceNo:Number(o.invoiceNo),date:ledgerIso(o.date)||String(o.date||''),
  name:String(o.name||''),total:fromCents(t),paid:0,owed:fromCents(t),cumulative:fromCents(cum)}});
 const due=toCents(d.due);
 const notes=['Chỉ liệt kê hóa đơn chưa trả trong khoảng ngày.'];
 if(d.truncated)notes.push('Sổ trả tối đa 100 hóa đơn: bảng kê thiếu dòng; tổng còn nợ theo debt.summary là '+vnd(fromCents(due))+'.');
 return {customerName:null,from:range.from,to:range.to,days,rows,
  totals:{total:fromCents(cum),paid:0,owed:fromCents(d.truncated?due:cum)},notes,fileName:'Cong-no-tong-'+range.to+'.pdf'};
}
async function renderStatement(st,deps){
 const render=deps.renderDebtPdf||renderDebtStatementPdf;
 return render({...st,generatedAt:new Date(deps.now??Date.now()).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})});
}

export async function debtStatementPdf(reader,args={},deps={}){
 const now=deps.now??Date.now();
 const range=resolveRange(args,{defaultDays:30,now});
 let customerRef=null;
 if(args.customer!=null||args.customerRef!=null){
  const c=await resolveCustomer(reader,args,deps.pool);
  if(c.needsSelection)return selectionReply(c);
  customerRef=c.customerRef;
 }
 // The link and the attached file are built from the SAME window (to + days).
 const st=await buildStatement(reader,{customerRef,days:range.days,to:range.to},deps.pool);
 const pdf=await renderStatement(st,deps);
 const link=signFileLink({k:'debt',d:range.days,to:range.to,...(customerRef?{n:customerRef.invoiceNo,id:customerRef.id}:{})},deps.env,now);
 return {fileName:st.fileName,sizeBytes:pdf.bytes.length,sha256:pdf.sha256,
  customer:st.customerName,range,invoiceCount:st.rows.length,totals:st.totals,
  downloadUrl:link?absoluteUrl(deps.baseUrl,link.path):null,expiresAt:link?.expiresAt||null,
  instruction:'Gửi file PDF đính kèm (hoặc downloadUrl, hết hạn sau 15 phút) cho chủ cửa hàng. Không sửa số liệu.',
  _attachments:attach('debt',st.fileName,pdf.bytes)};
}

export async function invoicePdf(reader,args={},deps={}){
 const {order}=await exactOrder(reader,{invoiceNo:args.invoiceNo,orderId:args.orderId},deps.pool);
 need(isActive(order),'ORDER_CANCELLED','Hóa đơn #'+order.invoiceNo+' đã hủy/không tính: không xuất PDF thanh toán.');
 const ref={invoiceNo:Number(order.invoiceNo),ledgerId:String(order.id)};
 const pdf=await (deps.invoicePdf||defaultInvoicePdf)(ref,reader);
 const link=signFileLink({k:'invoice',n:ref.invoiceNo,id:ref.ledgerId},deps.env,deps.now??Date.now());
 return {invoiceNo:ref.invoiceNo,fileName:pdf.filename,sizeBytes:pdf.bytes.length,sha256:pdf.sha256,
  downloadUrl:link?absoluteUrl(deps.baseUrl,link.path):null,expiresAt:link?.expiresAt||null,
  instruction:'PDF hóa đơn chính thức (không có UUID trong tên). Gửi file đính kèm hoặc downloadUrl (hết hạn 15 phút).',
  _attachments:attach('invoice',pdf.filename,pdf.bytes)};
}

/* ---------- orders / products / status ---------- */
const STATUS_FILTERS={all:()=>true,unpaid:o=>isActive(o)&&!isPaid(o),paid:o=>isPaid(o),cancelled:o=>!isActive(o)};
function monthWindows(from,to){
 const out=[];let start=from;
 while(start<=to&&out.length<4){
  const [y,m]=start.split('-').map(Number);
  const last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
  out.push({from:start,to:last<to?last:to});
  start=addDays(last,1);
 }
 return out;
}
export async function ordersList(reader,args={},now=Date.now()){
 const status=args.status??'all';
 need(Object.hasOwn(STATUS_FILTERS,status),'INVALID_STATUS','status: all, unpaid, paid hoặc cancelled.');
 const limit=Number.isSafeInteger(args.limit)?Math.min(50,Math.max(1,args.limit)):20;
 let rows=[],truncated=false;
 const customer=String(args.customer||'').trim();
 if(customer){
  need(customer.length>=2&&customer.length<=80,'INVALID_QUERY','customer 2-80 ký tự.');
  const range=args.from!=null||args.to!=null||args.days!=null?resolveRange(args,{now}):null;
  const r=await collectOrders(reader,customer,range?{from:range.from,to:range.to}:{});
  rows=r.rows.filter(o=>rowScore(o,customer)>=60);truncated=r.truncated;
 }else{
  const range=resolveRange(args,{defaultDays:30,now});
  const wins=monthWindows(range.from,range.to);
  need(wins.length<=3&&wins[wins.length-1].to===range.to,'RANGE_TOO_WIDE','Không có tên khách thì tối đa 3 tháng lịch; thêm customer hoặc thu hẹp ngày.');
  for(const w of wins){
   const r=await read(reader,'orders.list',{...w,limit:100});
   const list=Array.isArray(r.data.orders)?r.data.orders:[];
   if(list.length>=100||(Number.isSafeInteger(r.data.totalMatches)&&r.data.totalMatches>list.length))truncated=true;
   rows.push(...list);
  }
 }
 const filtered=rows.filter(STATUS_FILTERS[status]).sort((a,b)=>
  (ledgerIso(b.date)||'').localeCompare(ledgerIso(a.date)||'')||Number(b.invoiceNo)-Number(a.invoiceNo));
 return {count:Math.min(limit,filtered.length),totalMatched:filtered.length,truncated,status,
  orders:filtered.slice(0,limit).map(brief)};
}

export async function orderGet(reader,args={},pool=null){
 const {revision,order:o}=await exactOrder(reader,args,pool);
 return {ledgerRevision:revision,order:{...brief(o),
  items:(Array.isArray(o.items)?o.items:[]).map(i=>({code:String(i.code||''),product:String(i.product||i.name||''),
   unit:String(i.unit||''),qty:Number(i.qty),unitPrice:Number(i.unitPrice),listPrice:i.listPrice==null?null:Number(i.listPrice),
   ...(i.vatRate!=null?{vatRate:Number(i.vatRate)}:{}),...(i.vatExempt===true?{vatExempt:true}:{})})),
  shippingAmount:Number(o.shippingAmount||0),vatAmount:Number(o.vatAmount||0),
  ...(o.vatMode?{vatMode:o.vatMode}:{}),...(o.vatRate!=null?{vatRate:o.vatRate}:{}),
  deliveryDate:o.deliveryDate||null,deliveryNote:String(o.deliveryNote||''),
  customerPaidAt:o.customerPaidAt||null,satoriPaidAt:o.satoriPaidAt||null,updatedAt:o.updatedAt||null,
  ...(isActive(o)?{}:{note:'Hóa đơn "'+o.status+'": tính 0 đ trong công nợ/tổng bill; tổng gốc giữ để truy vết.'}),
  pair:o.pairGroupId?{role:o.pairRole||null,pairInvoiceNo:o.pairInvoiceNo||null}:null}};
}

export async function productsSearch(reader,args={}){
 const q=String(args.q||'').trim();
 need(q.length>=1&&q.length<=80,'INVALID_QUERY','Nhập tên hoặc mã sản phẩm (1-80 ký tự).');
 const r=await read(reader,'catalogue.list',{});
 const products=Array.isArray(r.data.products)?r.data.products:[];
 const scored=products.map(p=>({p,s:Math.max(
   /^tp-?\d+$/i.test(q)&&norm(p.code).replace('-','')===norm(q).replace('-','')?100:0,
   matchScore(p.name,q),matchScore(p.code,q),Math.round(matchScore([p.brand,p.spec].join(' '),q)*0.8),
   Math.round(matchScore([p.brand,p.name,p.spec].join(' '),q)*0.9))}))
  .filter(x=>x.s>=50).sort((a,b)=>b.s-a.s).slice(0,15);
 return {count:scored.length,source:'catalogue.list (bảng giá trên sổ)',ledgerRevision:r.revision,
  products:scored.map(({p,s})=>({code:p.code,name:p.name,brand:p.brand||'',spec:p.spec||'',unit:p.unit,
   listPrice:p.listPrice,standardUnitPrice:p.standardUnitPrice,standardDiscountPercent:p.standardDiscountPercent??0,
   priceText:vnd(p.standardUnitPrice)+' / '+p.unit+(p.listPrice!==p.standardUnitPrice?' (niêm yết '+vnd(p.listPrice)+')':''),
   matchScore:s}))};
}

export async function systemStatus(reader,env){
 const r=await read(reader,'system.status',{});
 return {ledgerRevision:r.revision,updatedAt:r.data.updatedAt||null,invoiceCount:Number.isSafeInteger(r.data.orders)?r.data.orders:null,
  grokWritesEnabled:env?.GROK_OWNER_WRITES_ENABLED==='1',readOnly:true};
}

export async function auditHistory(reader,args={},pool=null){
 const {order}=await exactOrder(reader,args,pool);
 const r=await read(reader,'orders.auditHistory',{invoiceNo:Number(order.invoiceNo),id:String(order.id)});
 return {invoiceNo:Number(order.invoiceNo),ledgerId:String(order.id),
  entries:Array.isArray(r.data.entries)?r.data.entries.slice(-50):[],
  status:String(order.status||'')};
}

export async function previewUpdate(reader,args={},pool=null){
 const reason=String(args.reason||'').trim();
 need(reason.length>=3&&reason.length<=300,'REASON_REQUIRED','Cần lý do sửa (3-300 ký tự).');
 const o=args.order;
 need(o&&typeof o==='object'&&!Array.isArray(o)&&Array.isArray(o.items)&&o.items.length>=1&&o.items.length<=50&&
  JSON.stringify(o).length<=20000,'INVALID_ORDER','order cần items (1-50 dòng).');
 const {revision,order:cur}=await exactOrder(reader,args,pool);
 need(isActive(cur)&&!isPaid(cur),'ORDER_LOCKED','Chỉ xem trước sửa cho hóa đơn chưa thanh toán và chưa hủy.');
 const r=await read(reader,'orders.previewUpdate',{expectedRevision:revision,
  requestId:'grokpreview-'+crypto.randomBytes(12).toString('hex'),invoiceNo:Number(cur.invoiceNo),id:String(cur.id),
  expectedName:String(cur.name||''),expectedTotal:Number(cur.total),confirmed:true,reason,order:o});
 return {preview:true,written:false,ledgerRevision:r.revision,before:brief(cur),after:r.data.order?brief(r.data.order):null,
  afterDetail:r.data.order||null,note:'Chỉ xem trước, KHÔNG ghi sổ. Grok không có lệnh sửa hóa đơn; muốn sửa thật dùng ChatGPT hoặc /owner-v2.'};
}

/* ---------- file download (signed short-lived link) ---------- */
export async function produceFile(payload,deps){
 if(payload.k==='invoice'){
  const {order}=await exactOrder(deps.reader,{invoiceNo:payload.n,orderId:payload.id});
  need(isActive(order),'ORDER_CANCELLED','Hóa đơn đã hủy.');
  return (deps.invoicePdf||defaultInvoicePdf)({invoiceNo:payload.n,ledgerId:payload.id},deps.reader);
 }
 const st=await buildStatement(deps.reader,{customerRef:payload.n?{invoiceNo:payload.n,id:payload.id}:null,days:payload.d,to:payload.to},deps.pool);
 const pdf=await renderStatement(st,deps);
 return {...pdf,filename:st.fileName};
}

/** GET /mcp/grok-files/<signed token>. Same 404 for bad, expired or disabled. */
export async function handleGrokFileHttp(req,res,pathname,deps){
 if(!String(pathname).startsWith(GROK_FILE_PREFIX))return false;
 const notFound=()=>{res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":false,"error":"NOT_FOUND"}')};
 if(req.method!=='GET'){res.writeHead(405,{allow:'GET'});res.end();return true}
 const payload=verifyFileToken(pathname.slice(GROK_FILE_PREFIX.length),deps.env,deps.now??Date.now());
 if(!payload){notFound();return true}
 let file;
 try{file=await produceFile(payload,deps)}catch{notFound();return true}
 const ascii=String(file.filename||'Minh-Satori.pdf').normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/đ/g,'d').replace(/Đ/g,'D').replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,120);
 res.writeHead(200,{'content-type':'application/pdf','content-length':String(file.bytes.length),
  'content-disposition':'attachment; filename="'+ascii+'"; filename*=UTF-8\'\''+encodeURIComponent(file.filename||ascii),
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 res.end(file.bytes);return true;
}

/* ---------- MCP tool definitions ---------- */
const range={days:{type:'integer',minimum:1,maximum:366,description:'Số ngày gần nhất (mặc định 30)'},
 from:{type:'string',description:'YYYY-MM-DD'},to:{type:'string',description:'YYYY-MM-DD'}};
const customerRefSchema={type:'object',required:['invoiceNo'],additionalProperties:false,
 properties:{id:{type:['string','integer']},invoiceNo:{type:'integer'}},description:'customerRef từ satori_find_customer / kết quả NEEDS_SELECTION'};
const orderRef={invoiceNo:{type:'integer',minimum:1,description:'Số hóa đơn (Hƒ)'},
 orderId:{type:['string','integer'],description:'Số hóa đơn hoặc ledgerId'}};
const RO={readOnlyHint:true,openWorldHint:false};

export const GROK_READ_TOOLS=[
 {name:'satori_system_status',title:'Minh Satori: trạng thái sổ',description:'Revision và tổng số hóa đơn hiện tại của sổ. Chỉ đọc.',
  inputSchema:{type:'object',additionalProperties:false,properties:{}},annotations:RO},
 {name:'satori_orders_list',title:'Minh Satori: danh sách hóa đơn',
  description:'Tra hóa đơn theo khách (tên gần đúng, không dấu), khoảng ngày và trạng thái (all/unpaid/paid/cancelled). Chỉ đọc.',
  inputSchema:{type:'object',additionalProperties:false,properties:{customer:{type:'string',maxLength:80},...range,
   status:{type:'string',enum:['all','unpaid','paid','cancelled']},limit:{type:'integer',minimum:1,maximum:50}}},annotations:RO},
 {name:'satori_order_get',title:'Minh Satori: chi tiết một hóa đơn',
  description:'Đọc đúng một hóa đơn theo số Hƒ (hoặc ledgerId): dòng hàng, VAT, phí giao, trạng thái thanh toán. Chỉ đọc.',
  inputSchema:{type:'object',additionalProperties:false,properties:orderRef},annotations:RO},
 {name:'satori_invoice_pdf',title:'Minh Satori: PDF hóa đơn',
  description:'Xuất PDF hóa đơn chính thức theo số Hƒ: trả file PDF đính kèm và link tải ký số hết hạn 15 phút. Chỉ đọc.',
  inputSchema:{type:'object',required:['invoiceNo'],additionalProperties:false,properties:orderRef},annotations:RO},
 {name:'satori_debt_summary',title:'Minh Satori: tổng công nợ',
  description:'Tổng công nợ và top khách nợ nhiều nhất (cùng nguồn debt.summary với ChatGPT). Không truyền ngày = toàn bộ. Chỉ đọc.',
  inputSchema:{type:'object',additionalProperties:false,properties:range},annotations:RO},
 {name:'satori_customer_debt',title:'Minh Satori: công nợ một khách',
  description:'Từng hóa đơn của một khách trong N ngày (mặc định 30): số Hƒ, ngày, tổng, đã trả, còn nợ, cộng dồn. '+
   'Tên gần đúng; nếu NEEDS_SELECTION thì hỏi chủ cửa hàng chọn rồi gọi lại với customerRef. Chỉ đọc.',
  inputSchema:{type:'object',additionalProperties:false,properties:{customer:{type:'string',maxLength:80},customerRef:customerRefSchema,...range}},annotations:RO},
 {name:'satori_debt_statement_pdf',title:'Minh Satori: PDF bảng kê công nợ',
  description:'Xuất PDF bảng kê công nợ theo khách (nếu có customer) hoặc tổng, N ngày (mặc định 30). Trả file PDF đính kèm và link tải hết hạn 15 phút. Chỉ đọc.',
  inputSchema:{type:'object',additionalProperties:false,properties:{customer:{type:'string',maxLength:80},customerRef:customerRefSchema,...range}},annotations:RO},
 {name:'satori_products_search',title:'Minh Satori: tìm sản phẩm + giá',
  description:'Tìm sản phẩm theo tên/mã (không dấu, gần đúng) trong bảng giá trên sổ: giá chuẩn, giá niêm yết, đơn vị. Chỉ đọc.',
  inputSchema:{type:'object',required:['q'],additionalProperties:false,properties:{q:{type:'string',minLength:1,maxLength:80}}},annotations:RO},
 {name:'satori_trash_list',title:'Minh Satori: Thùng Rác (hóa đơn đã xóa)',
  description:'Tìm hóa đơn đã XÓA còn trong Thùng Rác 30 ngày theo số Hƒ, tên hoặc SĐT. Chỉ đọc; dùng trước satori_order_restore_request.',
  inputSchema:{type:'object',required:['query'],additionalProperties:false,properties:{query:{type:'string',minLength:1,maxLength:80}}},annotations:RO},
 {name:'satori_order_audit_history',title:'Minh Satori: lịch sử sửa hóa đơn',
  description:'Lịch sử trước/sau của đúng một hóa đơn (dữ liệu riêng tư, chỉ chủ cửa hàng). Chỉ đọc.',
  inputSchema:{type:'object',additionalProperties:false,properties:orderRef},annotations:RO},
 {name:'satori_order_preview_update',title:'Minh Satori: xem trước sửa hóa đơn (không ghi)',
  description:'Tính lại hóa đơn chưa thanh toán theo nội dung sửa để XEM TRƯỚC; tuyệt đối không ghi sổ. Cần lý do.',
  inputSchema:{type:'object',required:['reason','order'],additionalProperties:false,properties:{...orderRef,
   reason:{type:'string',minLength:3,maxLength:300},
   order:{type:'object',required:['items'],description:'Nội dung hóa đơn mới (giống orders_preview_update của ChatGPT, kèm priceMode)',
    properties:{items:{type:'array',minItems:1,maxItems:50,items:{type:'object'}}}}}},annotations:RO}
];
export const GROK_READ_TOOL_NAMES=GROK_READ_TOOLS.map(t=>t.name);

/** deps: {reader, pool, env, baseUrl, now, invoicePdf, renderDebtPdf} */
export async function callGrokReadTool(deps,name,args={}){
 const {reader,pool,env}=deps,now=deps.now??Date.now();
 switch(name){
  case 'satori_system_status':return systemStatus(reader,env);
  case 'satori_orders_list':return ordersList(reader,args,now);
  case 'satori_order_get':return orderGet(reader,args,pool);
  case 'satori_invoice_pdf':return invoicePdf(reader,args,deps);
  case 'satori_debt_summary':return debtSummary(reader,args,now);
  case 'satori_customer_debt':return customerDebt(reader,args,pool,now);
  case 'satori_debt_statement_pdf':return debtStatementPdf(reader,args,deps);
  case 'satori_products_search':return productsSearch(reader,args);
  case 'satori_trash_list':return trashList(reader,args);
  case 'satori_order_audit_history':return auditHistory(reader,args,pool);
  case 'satori_order_preview_update':return previewUpdate(reader,args,pool);
  case 'satori_find_customer':return findCustomers(reader,args.query);
 }
 bad('UNKNOWN_TOOL','Công cụ không tồn tại.');
}
