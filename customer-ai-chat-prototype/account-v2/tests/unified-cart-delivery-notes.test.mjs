import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {parseV2DeliveryMessage,validatedV2QuoteDelivery} from '../old-gemini-delivery-note.mjs';
import {calculateQuote} from '../domain.mjs';
import {assertCurrentQuote} from '../quote-freshness.mjs';

const now=new Date('2026-10-28T09:00:00.000Z');
test('standalone "Lưu ý giao sau 2h" becomes a relative delivery REQUEST without a product',()=>{
 const parsed=parseV2DeliveryMessage('Lưu ý giao sau 2h',now);
 assert.equal(parsed.orderText,'');
 assert.equal(parsed.clarification,null);
 assert.equal(parsed.deliveryRequest.requestedDeliveryAt,'2026-10-28T11:00:00.000Z');
 assert.match(parsed.deliveryRequest.deliveryNote,/giao sau 2 giờ nữa/);
 assert.match(parsed.deliveryRequest.deliveryNote,/Khách yêu cầu/);
});
test('combined original Gemini product request and delivery note keep both parts intact',()=>{
 const parsed=parseV2DeliveryMessage('Thêm 3 thùng mãng cầu; lưu ý giao sau 2h',now);
 assert.equal(parsed.orderText,'Thêm 3 thùng mãng cầu');
 assert.equal(parsed.deliveryRequest.requestedDeliveryAt,'2026-10-28T11:00:00.000Z');
});
test('fixed-time 2 giờ chiều is not silently converted into a two-hour wait',()=>{
 const parsed=parseV2DeliveryMessage('Lưu ý giao sau 2 giờ chiều',now);
 assert.equal(parsed.deliveryRequest.requestedDeliveryAt,null);
 assert.match(parsed.deliveryRequest.deliveryNote,/14:00/);
});
test('unrelated messages do not gain a fabricated delivery note',()=>{
 const parsed=parseV2DeliveryMessage('Thêm 3 thùng mãng cầu',now);
 assert.equal(parsed.deliveryRequest,null);
 assert.equal(parsed.orderText,'Thêm 3 thùng mãng cầu');
});
test('untrusted, oversized, control-char, and inconsistent note snapshots are rejected',()=>{
 const good=parseV2DeliveryMessage('Lưu ý giao sau 2h',now).deliveryRequest;
 assert.deepEqual(validatedV2QuoteDelivery(good),good);
 assert.equal(validatedV2QuoteDelivery(null),null);
 for(const bad of [{deliveryNote:'',requestedDeliveryAt:null},
  {deliveryNote:'x'.repeat(301),requestedDeliveryAt:null},
  {deliveryNote:'hello\nworld',requestedDeliveryAt:null},
  {deliveryNote:'hợp lệ',requestedDeliveryAt:'tomorrow'},
  {deliveryNote:'hợp lệ',requestedDeliveryAt:null,extra:'ignored'}]){
  assert.throws(()=>validatedV2QuoteDelivery(bad),/V2_DELIVERY_NOTE_INVALID/);
 }
});
test('delivery note survives the immutable V2 quote snapshot without bypassing repricing',()=>{
 const accountId=randomUUID(),profileId=randomUUID(),addressId=randomUUID();
 const profile={id:profileId,accountId,type:'retail'};
 const address={id:addressId,profileId,active:true,label:'Nhà',
  recipientName:'Khách thử',recipientPhone:'0900000000',address:'Địa chỉ thử hợp lệ'};
 const catalogue=[{code:'TP-00003',name:'Satori 500ml',unit:'thùng',listPrice:100000,active:true}];
 const cart=[{code:'TP-00003',qty:10}];
 const context={accountId,profile,address,cart,catalogue,policies:[],catalogueRevision:176};
 const request=parseV2DeliveryMessage('Lưu ý giao sau 2h',now).deliveryRequest;
 const snapshot={...calculateQuote(context),deliveryRequest:request};
 assert.equal(assertCurrentQuote({...context,snapshot}),true);
 assert.throws(()=>assertCurrentQuote({...context,snapshot,
   catalogue:[{...catalogue[0],listPrice:110000}]}),{code:'QUOTE_CHANGED_REQUOTE_REQUIRED'});
 assert.throws(()=>assertCurrentQuote({...context,snapshot:{...snapshot,
   deliveryRequest:{deliveryNote:String.fromCharCode(0),requestedDeliveryAt:null}}}),{code:'QUOTE_SNAPSHOT_INVALID'});
});
test('V2 chat renders exactly one full 10+2+3 cart and not a separate receipt per message',()=>{
 const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const start=html.indexOf('async function addChatOrderReceipt(selection){');
 const end=html.indexOf("\n$('send').onclick=async()=>{",start);
 assert.ok(start>=0&&end>start);
 const summary=html.slice(start,end);
 assert.match(summary,/const fullCart=cart\.map\(line=>\(\{code:line\.code,qty:line\.qty\}\)\)/);
 assert.match(summary,/for\(const line of fullCart\)/);
 assert.doesNotMatch(summary,/for\(const line of selection\)/);
 assert.match(summary,/querySelectorAll\('\.chat-order-receipt'\)\.forEach\(previous=>previous\.remove\(\)\)/);
 assert.match(summary,/activeDeliveryRequest\(\)/);
 assert.match(html,/id="cartDeliveryNote"/);
 assert.match(html,/deliveryRequest:activeDeliveryRequest\(\)/);
 assert.match(html,/quote\.deliveryRequest\?\.deliveryNote/);
 assert.match(html,/result\.source==='v2-delivery-note'/);
 assert.match(router,/parseV2DeliveryMessage\(input\.message\)/);
 assert.match(router,/JSON\.stringify\(payload\)/);
 assert.match(router,/REAL_CHECKOUT_GATE_NOT_VERIFIED/);
 assert.doesNotMatch(summary,/orders\.create|fetch\('https:\/\/script\.google/);
});
