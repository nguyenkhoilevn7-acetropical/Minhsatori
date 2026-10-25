/**
 * Read a Vietnamese contact telephone from the existing phone/contact field.
 * Historic Satori invoices often store "Hằng - 0784723916" or
 * "0903507433 (Cô Hoa)" instead of a bare phone string.
 *
 * This never scans addresses, uses account-wide guesses, or borrows numbers
 * from another invoice. Ambiguous multi-number fields fail closed.
 */
export function contactPhone(value){
 const raw=String(value??'').trim();
 if(!raw||raw.length>160)return '';
 const matches=[];
 const pattern=/(?:^|[^\d])((?:\+?84[\s.\-]?|0)?\d(?:[\s.\-]?\d){7,10})(?!\d)/g;
 for(const match of raw.matchAll(pattern)){
  let phone=match[1].replace(/\D/g,'');
  if(/^84\d{9}$/.test(phone))phone='0'+phone.slice(2);
  if(phone.length>=9&&phone.length<=11)matches.push(phone);
 }
 return matches.length===1?matches[0]:'';
}
