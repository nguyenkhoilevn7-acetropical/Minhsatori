/* Isolated tests for natural Vietnamese delivery instructions; never call an external API. */
import assert from 'node:assert/strict';
import {extractDeliveryIntent} from '../delivery-intent.mjs';
const at=new Date('2026-10-20T05:20:00.000Z'); // 12:20 Vietnam time
let n=0;function ok(test,msg){assert.ok(test,msg);n++}
const first=extractDeliveryIntent('Cho tôi 10 thùng nước Satori 500ml và giao sau 2 giờ chiều, nhớ gọi trước khi giao',at);
ok(first.deliveryNote.includes('14:00'),'2 pm converted to 14:00');
ok(first.deliveryNote.includes('gọi trước khi giao'),'extra instructions preserved');
ok(!first.clarification,'explicit afternoon does not ask again');
const later=extractDeliveryIntent('Cho tôi 10 thùng nước Satori 500ml, giao sau 2 giờ nữa',at);
ok(later.deliveryNote.includes('14:20 ngày 20/10/2026'),'relative 2h resolved in VN local time');
ok(later.requestedDeliveryAt==='2026-10-20T07:20:00.000Z','relative delivery timestamp based on order message time');
const third=extractDeliveryIntent('Đặt 2 bình Satori, giao sau 3 tiếng nữa',at);
ok(third.requestedDeliveryAt==='2026-10-20T08:20:00.000Z','3 tiếng nữa means +3h');
const unclear=extractDeliveryIntent('Cho 10 thùng 500ml giao sau 2 giờ',at);
ok(!!unclear.clarification&&!unclear.deliveryNote,'ambiguous 2 giờ asks clarification');
const fixed=extractDeliveryIntent('Cho 10 thùng, giao lúc 14h30',at);
ok(fixed.deliveryNote.includes('14:30'),'24-hour clock 14h30');
const future=extractDeliveryIntent('Cho 10 thùng, giao sau 3 giờ chiều mai',at);
ok(future.deliveryNote.includes('15:00 ngày mai'),'tomorrow preserved');
const night=extractDeliveryIntent('Cho 10 thùng, giao lúc 12 giờ đêm',at);
ok(night.deliveryNote.includes('00:00'),'midnight is 00:00');
const raw=extractDeliveryIntent('Cho 10 thùng Satori 500ml, nhớ để ở bảo vệ và gọi trước khi tới',at);
ok(raw.deliveryNote.includes('nhớ để ở bảo vệ'),'freeform delivery note included');
const none=extractDeliveryIntent('Cho tôi 10 thùng Satori 500ml',at);
ok(none.deliveryNote==='','ordinary order no invented instructions');
const noAddressChange=extractDeliveryIntent('Cho 10 thùng giao sau 2 giờ chiều',at);
ok(noAddressChange.clarification===null,'delivery time not mistaken for identity change');
console.log('PASS '+n+'/'+n+' natural Vietnamese delivery-intent rules');
