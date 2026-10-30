/**
 * Catalogue-backed per-unit VND conversion.
 * The display discount has 0.01 percentage-point precision.
 * An explicitly entered unit sale price remains exact after saving;
 * it may differ a few VND from recomputing the rounded percentage.
 */
const check=(v)=>Number.isSafeInteger(v)&&v>=0&&v<=1_000_000_000;
export function unitPriceFromDiscount(listPrice,discountBps){
 if(!check(listPrice)||listPrice<1||!Number.isSafeInteger(discountBps)||
  discountBps<0||discountBps>10000)throw new RangeError('SALE_PRICE_INVALID');
 return Math.round(listPrice*(10000-discountBps)/10000);
}
export function discountFromUnitPrice(listPrice,unitPrice){
 if(!check(listPrice)||listPrice<1||!check(unitPrice)||unitPrice>listPrice)
  throw new RangeError('SALE_PRICE_INVALID');
 return Math.round((listPrice-unitPrice)*10000/listPrice);
}
export function validateExactUnitPrice(listPrice,unitPrice,discountBps){
 if(discountFromUnitPrice(listPrice,unitPrice)!==discountBps)
  throw new RangeError('SALE_PRICE_RATE_MISMATCH');
 return unitPrice;
}
