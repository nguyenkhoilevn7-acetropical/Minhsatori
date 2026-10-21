import assert from 'node:assert/strict';
import {customerSuggestions} from '../customer-suggestions.mjs';
const now=new Date().toISOString(),A={id:'customer-A',favourite:'TP-00136'},B={id:'customer-B',favourite:'TP-00058'};
const fake=(profileId,ref,skus,options={})=>({sandbox:true,profileId,ref,createdAt:now,status:'Chờ thanh toán',items:skus.map(code=>({code,qty:2})),...options});
let tests=0;function check(x,msg){assert.ok(x,msg);tests++}
const orders=[fake('customer-A','TEST-A1',['TP-00003','TP-00056']),
 fake('customer-A','TEST-A2',['TP-00003']),
 fake('customer-B','TEST-B1',['TP-00058']),
 fake('customer-B','TEST-B2',['TP-00058','TP-00051']),
 fake('customer-A','TEST-DELETED',['TP-00051'],{status:'Đã hủy'}),
 fake('customer-A','TEST-ADMIN',['TP-00136'],{ownerTest:true}),
 {sandbox:false,profileId:'customer-A',ref:'LIVE-SECRET',items:[{code:'TP-00051',qty:20}],createdAt:now}];
let a=customerSuggestions(A,orders),b=customerSuggestions(B,orders);
check(a[0].code==='TP-00003'&&a[0].orderCount===2,'A sees own repeat water purchase first');
check(b[0].code==='TP-00058'&&b[0].orderCount===2,'B sees different repeat juice first');
check(!a.some(p=>p.orderCount>0&&p.code==='TP-00058'),'B historical purchases never appear in A personal score');
check(!b.some(p=>p.orderCount>0&&p.code==='TP-00003'),'A historical purchases never appear in B personal score');
check(!a.some(p=>p.orderCount>0&&p.code==='TP-00051'),'cancelled or production entries not counted');
check(!a.some(p=>p.orderCount>0&&p.code==='TP-00136'),'owner-test entries not counted');
check(a[0].reason==='Mua thường xuyên'&&b[0].reason==='Mua thường xuyên','historical provenance label accurate');
check(customerSuggestions(A,[])[0].code==='TP-00136','configured favourite shown for new customer');
check(customerSuggestions(B,[])[0].code==='TP-00058','second new customer has distinct recommendation');
check(customerSuggestions({id:'customer-C'},[]).every(p=>p.reason==='Gợi ý tham khảo'),'new customer never given fake historical label');
check(customerSuggestions({id:'customer-D'},orders).every(p=>p.orderCount===0),'no cross-link history');
check(customerSuggestions(A,orders,100).length<=5,'bounded recommendations');
console.log('PASS '+tests+'/'+tests+' per-customer ranked, privacy-safe product suggestions');
