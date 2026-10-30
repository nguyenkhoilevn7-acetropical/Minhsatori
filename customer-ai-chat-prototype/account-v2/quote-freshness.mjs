/**
 * Reprice immediately before accepting an isolated V2 test request.
 * Never treats a historical quotation as ongoing permission to ship,
 * apply an old discount, or use a changed/deactivated destination.
 * This guard must ALSO be used by any future signed ledger bridge.
 */
import {isDeepStrictEqual} from 'node:util';
import {calculateQuote,DomainError} from './domain.mjs';
import {validatedV2QuoteDelivery} from './old-gemini-delivery-note.mjs';

export function assertCurrentQuote({snapshot,accountId,profile,address,cart,catalogue,policies,catalogueRevision,vatBps=0,shippingVnd=0}){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))
  throw new DomainError('QUOTE_SNAPSHOT_INVALID');
 let current;
 try{
  current=calculateQuote({accountId,profile,address,cart,catalogue,policies,catalogueRevision,vatBps,shippingVnd});
 }catch(e){
  // Detailed object/price errors should not reveal customer or commercial policy.
  if(e instanceof DomainError)throw new DomainError('QUOTE_CHANGED_REQUOTE_REQUIRED');
  throw e;
 }
 // A customer note may accompany the immutable price snapshot. Validate and
 // exclude only this known non-price field before comparing every price/policy
 // and delivery-address field byte-for-byte as before.
 const {deliveryRequest,...financialSnapshot}=snapshot;
 try{
  if(deliveryRequest!==undefined)validatedV2QuoteDelivery(deliveryRequest);
 }catch{throw new DomainError('QUOTE_SNAPSHOT_INVALID')}
 if(!isDeepStrictEqual(current,financialSnapshot))
  throw new DomainError('QUOTE_CHANGED_REQUOTE_REQUIRED');
 return true;
}
