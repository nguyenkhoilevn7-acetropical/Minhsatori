/**
 * V2 PDF — uses the EXACT website pdfmake renderer in original-website-pdf.mjs.
 *
 * Owner/Android edits are reflected by a verified, exact-ID canonical ledger
 * read on EVERY customer download. No Drive PDF archive, second invoice,
 * customer-price estimation, external renderer, trigger or public file URL.
 */
import crypto from 'node:crypto';
import {renderOriginalWebsitePdf,canonicalPdfVersion,PDF_TEMPLATE_VERSION} from '../original-website-pdf.mjs';

function fail(code){const e=new Error(code);e.code=code;throw e}
function money(value){
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0||n>100_000_000_000)fail('V2_PDF_AMOUNT_INVALID');
 return n;
}
function boundText(value,max=400){return String(value??'').slice(0,max)}
const identity=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);

/**
 * Map current signed ledger projection to the exact original website
 * document definition. Trust NO customer/browser-supplied money or recipient.
 */
export function currentInvoiceForWebsitePdf(current,{invoiceNo,ledgerId},{allowArchived=false}={}){
 if(!Number.isSafeInteger(invoiceNo)||invoiceNo<1||!identity(String(ledgerId))||
    !current||current.missing||
    ((current.excluded===true||current.status==='Đã hủy'||
      current.status==='Không Tính')&&
      !(allowArchived===true&&current.excluded===true&&
        current.status==='Đã hủy'))||
    Number(current.invoiceNo)!==invoiceNo||String(current.id)!==String(ledgerId))
  fail('V2_PDF_CURRENT_INVOICE_REQUIRED');
 if(!current.delivery||!Array.isArray(current.items)||
    current.items.length<1||current.items.length>40)fail('V2_PDF_LINES_INVALID');
 let goods=0;
 const items=current.items.map(line=>{
  if(!line||typeof line!=='object'||!Number.isSafeInteger(line.qty)||
     line.qty<1||line.qty>100_000)fail('V2_PDF_LINES_INVALID');
  const unitPrice=money(line.unitPrice);
  const listPrice=money(line.listPrice);
  const lineTotal=money(line.lineTotal);
  if(line.qty*unitPrice!==lineTotal)fail('V2_PDF_LINE_CONFLICT');
  goods+=lineTotal;
  const computedDiscount=listPrice>0?Math.round((1-unitPrice/listPrice)*10_000)/100:0;
  if(!Number.isFinite(computedDiscount)||computedDiscount<0||
     computedDiscount>100)fail('V2_PDF_DISCOUNT_INVALID');
  return {
   product:boundText(line.name,200),
   code:boundText(line.code,40),
   unit:boundText(line.unit||'Thùng',30),
   qty:line.qty,listPrice,unitPrice,discountPercent:computedDiscount
  };
 });
 const canonicalGoods=money(current.goodsVnd);
 const shipping=money(current.shippingVnd),vat=money(current.vatVnd);
 const total=money(current.totalVnd);
 if(goods!==canonicalGoods||goods+vat+shipping!==total)
  fail('V2_PDF_TOTAL_CONFLICT');
 const o={
  id:String(current.id),invoiceNo,date:boundText(current.date,30),
  name:boundText(current.delivery.recipientName,120),
  phone:boundText(current.delivery.recipientPhone,30),
  location:boundText(current.delivery.address,400),
  taxCode:boundText(current.taxCode,50),status:boundText(current.status,45),
  deliveryNote:boundText(current.deliveryNote,500),
  items,vat:vat>0?'yes':'no',vatAmount:vat,shippingAmount:shipping,total
 };
 return Object.freeze(o);
}

/** Includes a content-addressed versionKey for edit/readback verification. */
export async function renderCurrentV2Pdf(current,expected,{
 render=renderOriginalWebsitePdf,allowArchived=false
}={}){
 const doc=currentInvoiceForWebsitePdf(current,expected,{allowArchived});
 const output=await render(doc);
 if(!output||!Buffer.isBuffer(output.bytes)||output.bytes.length<100||
    output.bytes.length>3*1024*1024||
    output.bytes.subarray(0,5).toString('ascii')!=='%PDF-'||
    output.versionKey!==canonicalPdfVersion(doc)||
    !/^[a-f0-9]{64}$/.test(output.sha256||'')||
    crypto.createHash('sha256').update(output.bytes).digest('hex')!==output.sha256)
  fail('V2_PDF_RENDER_VERIFICATION_FAILED');
 return Object.freeze({
  bytes:output.bytes,sha256:output.sha256,versionKey:output.versionKey,
  template:PDF_TEMPLATE_VERSION,invoiceNo:doc.invoiceNo,ledgerId:doc.id,
  cancelled:allowArchived===true
 });
}
