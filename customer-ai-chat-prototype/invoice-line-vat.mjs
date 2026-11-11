/** Optional canonical VAT snapshot; legacy PDFs never infer item tax rates. */
const fail=code=>{throw Error(code)};
function rate(value){
 const n=Number(value);
 if(value===null||value===undefined||value===''||!Number.isFinite(n)||
    n<0||n>100||Number(n.toFixed(2))!==n)fail('PDF_LINE_VAT_RATE_INVALID');
 return n;
}
export function invoiceLineVatSnapshot(order){
 if(order.vatMode!=='per_line')return null;
 const header=order.vatRate==null?null:rate(order.vatRate);
 const lines=order.items.map(item=>{
  if(item.vatExempt!==undefined&&typeof item.vatExempt!=='boolean')
   fail('PDF_LINE_VAT_EXEMPT_INVALID');
  const exempt=item.vatExempt===true;
  const percent=exempt?0:item.vatRate==null?header:rate(item.vatRate);
  if(percent===null)fail('PDF_LINE_VAT_RATE_REQUIRED');
  const subtotal=Number(item.qty)*Number(item.unitPrice);
  if(!Number.isSafeInteger(subtotal)||subtotal<0)fail('PDF_LINE_VAT_AMOUNT_INVALID');
  const amount=Number((BigInt(subtotal)*BigInt(Math.round(percent*100))+5000n)/10000n);
  if(!Number.isSafeInteger(amount)||
     (item.vatAmount!=null&&Number(item.vatAmount)!==amount))fail('PDF_LINE_VAT_MISMATCH');
  return {vatExempt:exempt,vatRate:percent,vatAmount:amount};
 });
 const total=lines.reduce((n,item)=>n+item.vatAmount,0);
 if(!Number.isSafeInteger(total)||total!==Number(order.vatAmount))fail('PDF_VAT_MISMATCH');
 return {header,lines,total};
}
