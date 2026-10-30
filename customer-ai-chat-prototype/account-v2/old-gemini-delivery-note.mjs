/**
 * Reuse the ORIGINAL Gemini chat's delivery-note recognizer inside V2.
 * A customer note never creates an invoice or promises a delivery time.
 * The old parser keeps handling items; V2 keeps identity, pricing, and storage.
 */
import {splitOrderAndNote} from '../order-with-notes.mjs';
import {extractDeliveryIntent} from '../delivery-intent.mjs';

export function parseV2DeliveryMessage(message,now=new Date()){
 const {orderText,noteText}=splitOrderAndNote(message);
 if(!noteText)return {orderText:message,deliveryRequest:null,clarification:null};
 // Spoken "giao sau 2h" is a relative delay, NOT the fixed clock 02:00.
 // Avoid rewriting "giao sau 2 giờ chiều", which must use clock semantics.
 const relative=noteText.replace(/(giao\s+sau\s+)(\d{1,2})\s*(?:h|giờ|tiếng)(?!\s*(?:sáng|chiều|tối|trưa))(?=\s*(?:$|[,;.!?]|nhớ|gọi|để))/iu,
  '$1$2 giờ nữa');
 const result=extractDeliveryIntent(relative,now);
 if(result.clarification)return {orderText,deliveryRequest:null,clarification:result.clarification};
 if(!result.deliveryNote)return {orderText,deliveryRequest:null,clarification:'Vui lòng ghi rõ yêu cầu giao hàng.'};
 return {orderText,deliveryRequest:{
  deliveryNote:result.deliveryNote,
  requestedDeliveryAt:result.requestedDeliveryAt||null
 },clarification:null};
}
export function validatedV2QuoteDelivery(value){
 if(value==null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('V2_DELIVERY_NOTE_INVALID');
 const keys=Object.keys(value);
 if(keys.length!==2||!keys.includes('deliveryNote')||!keys.includes('requestedDeliveryAt'))
  throw Error('V2_DELIVERY_NOTE_INVALID');
 const {deliveryNote,requestedDeliveryAt}=value;
 if(typeof deliveryNote!=='string'||!deliveryNote.trim()||deliveryNote.length>300||
    /[\u0000-\u001f\u007f]/.test(deliveryNote))throw Error('V2_DELIVERY_NOTE_INVALID');
 if(requestedDeliveryAt!==null){
  if(typeof requestedDeliveryAt!=='string'||
     !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(requestedDeliveryAt)||
     !Number.isFinite(Date.parse(requestedDeliveryAt)))
   throw Error('V2_DELIVERY_NOTE_INVALID');
 }
 return {deliveryNote:deliveryNote.trim(),requestedDeliveryAt};
}
