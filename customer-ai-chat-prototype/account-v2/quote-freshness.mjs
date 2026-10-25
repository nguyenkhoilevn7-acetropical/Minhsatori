/**
 * Reprice immediately before accepting an isolated V2 test request.
 * Never treats a historical quotation as ongoing permission to ship,
 * apply an old discount, or use a changed/deactivated destination.
 * This guard must ALSO be used by any future signed ledger bridge.
 */
import {isDeepStrictEqual} from 'node:util';
import {calculateQuote,DomainError} from './domain.mjs';

export function assertCurrentQuote({snapshot,accountId,profile,address,cart,catalogue,policies,catalogueRevision}){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))
  throw new DomainError('QUOTE_SNAPSHOT_INVALID');
 let current;
 try{
  current=calculateQuote({accountId,profile,address,cart,catalogue,policies,catalogueRevision});
 }catch(e){
  // Detailed object/price errors should not reveal customer or commercial policy.
  if(e instanceof DomainError)throw new DomainError('QUOTE_CHANGED_REQUOTE_REQUIRED');
  throw e;
 }
 if(!isDeepStrictEqual(current,snapshot))
  throw new DomainError('QUOTE_CHANGED_REQUOTE_REQUIRED');
 return true;
}
