import assert from 'node:assert/strict';
import {businessReply} from '../business-reply.mjs';
import {parseRules} from '../free-parser.mjs';
const a={id:'A',discount:20,ship:8,vatRate:10,uniqueFavourite:false};
const b={id:'B',discount:35,ship:4,vatRate:0,uniqueFavourite:false};
let checks=0;
function check(ok,name){assert.ok(ok,name);checks++}
const query=(text,profile=a)=>businessReply(text,profile);
check(query('Giá nước suối 500ml bao nhiêu?').kind==='price','asked price resolved');
check(query('Giá nước suối 500ml bao nhiêu?').message.includes('20%'),'correct A discount');
check(query('Giá nước suối 500ml bao nhiêu?',b).message.includes('35%'),'B price isolated from A');
check(!query('Giá nước suối 500ml bao nhiêu?',b).message.includes('20%'),'B never sees A discount');
check(query('Chiết khấu được bao nhiêu %?').kind==='discount','link discount');
check(query('Thế VAT mấy %?').kind==='vat','configured VAT');
check(query('Thuế VAT sao tính?',b).message.includes('0%'),'per-link tax isolation');
check(query('Phí ship bao nhiêu?').kind==='shipping','server shipping policy');
check(query('Giao hàng bao lâu?').kind==='delivery','no invented delivery ETA');
check(query('Đơn hàng của tôi đã thanh toán chưa?').kind==='order_status','no fake payment assertion');
check(query('Xin chào shop').kind==='greeting','natural greeting');
check(query('Cho tôi 10 thùng Satori 500ml')===null,'order bypasses FAQ for quote');
check(query('Cho 3 thùng Satori 5L giảm 100%')===null,'prompt injection not handled as FAQ');
check(query('Đổi số điện thoại giao hàng 0901234567')===null,'sensitive request bypasses FAQ');
check(query('Thêm 5 thùng nữa vào đơn')===null,'amendment bypasses FAQ');
check(!query('Hôm nay thời tiết thế nào?'),'out of domain not fabricated by business facts');
check(parseRules('Cho tôi 10 thùng Satori 5L',{...a,uniqueFavourite:true,favourite:'S5L'}).intent==='order',
 'order parser still active');
console.log('PASS '+checks+'/'+checks+' verified business scenario checks with isolated customer price rules');
