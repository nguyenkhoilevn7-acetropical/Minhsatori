/** Read-only canonical ledger access. No arbitrary name/phone matching, PDF URL forwarding or writes. */
import {isUuid,DomainError} from './domain.mjs';
import {readMinhSatori} from '../satori-readonly.mjs';
const check=(v,c)=>{if(!v)throw new DomainError(c)};
const money=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export async function exactInvoice(binding,read=readMinhSatori){
 const response=await read('orders.list',{query:String(binding.invoice_no),limit:100});
 const matches=(response?.data?.orders||[]).filter(o=>String(o.id)===binding.legacy_id&&Number(o.invoiceNo)===Number(binding.invoice_no));
 check(matches.length===1,'CANONICAL_INVOICE_NOT_VERIFIED');
 check(Number.isSafeInteger(response.revision)&&response.revision>=Number(binding.verified_revision||0),'CANONICAL_REVISION_STALE');
 return {order:matches[0],revision:response.revision};
}
export function publicInvoice(order,revision){
 check(money(order.total),'CANONICAL_TOTAL_INVALID');
 const paid=money(order.paidAmount)?order.paidAmount:null;
 check(paid===null||paid<=order.total,'CANONICAL_PAYMENT_INVALID');
 // A generic status/paidAt does not prove partial payment sums or payment history.
 return {invoiceNo:Number(order.invoiceNo),date:String(order.date||'').slice(0,30),
  customerName:String(order.name||'').slice(0,120),address:String(order.location||'').slice(0,400),
  totalVnd:order.total,currency:'VND',status:String(order.status||'').slice(0,50),
  paidVnd:paid,dueVnd:paid===null?null:order.total-paid,
  paymentHistoryAvailable:false,source:'canonical-ledger',revision,
  pdf:{available:false,reason:'CANONICAL_PDF_ADAPTER_NOT_VERIFIED'},
  items:Array.isArray(order.items)?order.items.slice(0,40).map(l=>({
   name:String(l.name||l.product||'').slice(0,180),unit:String(l.unit||'').slice(0,40),
   qty:Number.isSafeInteger(l.qty)&&l.qty>0?l.qty:null,
   unitPriceVnd:money(l.unitPrice)?l.unitPrice:null,
   totalVnd:money(l.total)?l.total:null})):[]};
}
export async function bindInvoice(pool,owner,input,read=readMinhSatori){
 check(input.confirmedIdentity===true,'INVOICE_IDENTITY_CONFIRMATION_REQUIRED');
 check(isUuid(input.accountId)&&typeof input.legacyId==='string'&&input.legacyId.length>0&&input.legacyId.length<=160,
  'INVOICE_BINDING_INVALID');
 check(Number.isSafeInteger(input.invoiceNo)&&input.invoiceNo>0&&Number.isSafeInteger(input.expectedLedgerRevision),
  'INVOICE_REFERENCE_INVALID');
 const binding={legacy_id:input.legacyId,invoice_no:input.invoiceNo,verified_revision:input.expectedLedgerRevision};
 const verified=await exactInvoice(binding,read);
 check(verified.revision===input.expectedLedgerRevision,'CANONICAL_REVISION_CHANGED');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const a=await c.query("SELECT id FROM satori_v2_accounts WHERE id=$1 AND access_status='ACTIVE' FOR SHARE",[input.accountId]);
  check(a.rows.length===1,'INVOICE_ACCOUNT_NOT_ACTIVE');
  const r=await c.query('INSERT INTO satori_v2_invoice_bindings(account_id,legacy_id,invoice_no,verified_revision,verified_by) '+
   'VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',
   [input.accountId,input.legacyId,input.invoiceNo,verified.revision,owner.id]);
  check(r.rows.length===1,'INVOICE_ALREADY_BOUND');
  await c.query("INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) VALUES($1,'owner','INVOICE_ACCESS_BOUND',$2,$3)",
   [owner.id,r.rows[0].id,JSON.stringify({accountId:input.accountId,invoiceNo:input.invoiceNo,revision:verified.revision})]);
  await c.query('COMMIT');return {ok:true,bindingId:r.rows[0].id};
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function invoiceDetail(pool,actor,id,read=readMinhSatori){
 check(isUuid(id),'INVOICE_ID_INVALID');
 // Scope BEFORE contacting the ledger. Unauthorized users cause no upstream lookup.
 const r=await pool.query('SELECT legacy_id,invoice_no,verified_revision FROM satori_v2_invoice_bindings WHERE id=$1 AND account_id=$2',[id,actor.id]);
 check(r.rows.length===1,'INVOICE_FORBIDDEN');
 const result=await exactInvoice(r.rows[0],read);
 return {ok:true,id,...publicInvoice(result.order,result.revision)};
}
export async function invoiceIndex(pool,actor,{before=null}={}){
 check(before===null||(!Number.isNaN(Date.parse(before))&&before.length<=40),'INVOICE_CURSOR_INVALID');
 const r=await pool.query('SELECT id,invoice_no AS "invoiceNo",created_at AS "linkedAt" FROM satori_v2_invoice_bindings '+
  'WHERE account_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2) ORDER BY created_at DESC LIMIT 50',[actor.id,before]);
 return {ok:true,source:'owner-verified-invoice-bindings',invoices:r.rows,
  nextBefore:r.rows.length===50?r.rows.at(-1).linkedAt:null};
}
