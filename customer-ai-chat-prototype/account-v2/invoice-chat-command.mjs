/** Strict account-owned invoice commands for the V2 Gemini chat.
 * Invoice lookups never go to the generative model or alter the cart.
 */
import {invoiceIndex} from './invoice-history.mjs';

function fold(message){
 return String(message||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase()
  .replace(/\s+/g,' ').trim();
}
export function parseInvoiceCommand(message){
 if(typeof message!=='string'||message.length>500)return null;
 const text=fold(message);
 if(!/\b(hoa don|bill)\b/.test(text))return null;
 const match=text.match(/\b(?:hoa don|bill)\s*(?:so\s*|ma\s*|#\s*)?(\d{1,9})\b/);
 if(match){
  const invoiceNo=Number(match[1]);
  if(Number.isSafeInteger(invoiceNo)&&invoiceNo>0)return {kind:'detail',invoiceNo};
 }
 if(/\b(lich su|danh sach|cac|cua toi|da mua|hoa don cua)\b/.test(text)||
    /^(?:xem |mo |gui |cho toi xem )?(?:hoa don|bill)(?: cua toi)?$/.test(text))
  return {kind:'history'};
 return null;
}
export async function invoiceChatReply(pool,actor,message){
 const command=parseInvoiceCommand(message);
 if(!command)return null;
 if(command.kind==='history'){
  const index=await invoiceIndex(pool,actor);
  const items=(index.invoices||[]).slice(0,5);
  return {provider:'verified-invoice-history',suggestedItems:[],
   invoiceReferences:items.map(x=>({id:x.id,invoiceNo:x.invoiceNo,pdfAvailable:false})),
   message:items.length?'Tài khoản có '+String(index.invoices.length)+
    ' hóa đơn đã được liên kết. Mở mục Hóa đơn để xem và tải PDF gốc khi được xác minh.':
    'Tài khoản chưa có hóa đơn gốc được xác minh và liên kết. Em không tự tạo hóa đơn mới.'};
 }
 // Tenant-scoped search BEFORE any canonical ledger / PDF fetch.
 const r=await pool.query('SELECT id,invoice_no AS "invoiceNo" FROM satori_v2_invoice_bindings '+
  'WHERE account_id=$1 AND invoice_no=$2 ORDER BY created_at DESC LIMIT 2',
  [actor.id,command.invoiceNo]);
 if(r.rows.length!==1){
  return {provider:'verified-invoice-history',suggestedItems:[],
   message:r.rows.length>1?
    'Có nhiều hồ sơ hóa đơn cùng số trong tài khoản. Vui lòng mở lịch sử để chọn đúng bản.':
    'Chưa tìm thấy hóa đơn #'+command.invoiceNo+
    ' đã được liên kết với tài khoản. Em không thể lấy hóa đơn theo tên hay số điện thoại.'};
 }
 const match=r.rows[0];
 return {provider:'verified-invoice-history',suggestedItems:[],
  invoiceReference:{id:match.id,invoiceNo:match.invoiceNo,pdfAvailable:false},
  message:'Đã tìm thấy hồ sơ hóa đơn #'+match.invoiceNo+
   ' trong tài khoản. Chọn Xem hóa đơn để đối soát sổ gốc và tải đúng PDF khi tệp đã sẵn sàng.'};
}
