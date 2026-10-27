// Isolated regression tests: fake invoices only, no external services or live Drive.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../api/BotApi.gs','utf8');
const marker='return {handle:handle,ownerMobileWrite:ownerMobileWrite};';
assert.equal(source.split(marker).length,2,'expected one BotApi export marker');
const exposed=source.replace(marker,
  'return {handle:handle,ownerMobileWrite:ownerMobileWrite,testCorrectPaymentStatus:correctPaymentStatus};');
const ctx={};vm.createContext(ctx);vm.runInContext(exposed,ctx);
const correct=ctx.SatoriBotApi.testCorrectPaymentStatus;
assert.equal(typeof correct,'function');
const name='CÔNG TY CỔ PHẦN THƯƠNG MẠI DỊCH VỤ VINAHASA (Ốc Q)';
const paidAt='2026-10-27T03:09:02.715Z';
function rows(){return [
  {id:1792939447917,invoiceNo:5952,name,total:1242000,status:'Chưa thanh toán',
   customerPaidAt:null,customerPaymentReceiptUrl:null,customerPaymentReceiptAt:null,
   customerPaymentNote:null,vatAmount:92000},
  {id:1792321842277,invoiceNo:5923,name,total:1242000,status:'Đã thanh toán',
   customerPaidAt:paidAt,customerPaymentReceiptUrl:null,customerPaymentReceiptAt:null,
   customerPaymentNote:null,vatAmount:92000}
]}
function payload(o,changes={}){return {expectedRevision:170,requestId:'payment-correct-5952',
 id:o.id,invoiceNo:o.invoiceNo,expectedName:o.name,expectedTotal:o.total,
 expectedStatus:o.status,expectedCustomerPaidAt:o.customerPaidAt||null,
 targetStatus:'Đã TT Satori',reason:'Chủ tài khoản xác nhận thanh toán trực tiếp cho Satori',
 confirmed:true,...changes}}
function state(list){return {revision:170,values:{satori_orders_v15:JSON.stringify(list)}}}
function failure(fn,code){assert.throws(fn,e=>e&&e.code===code)}
{
 const all=rows(),s=state(all),p=payload(all[0]);
 const outcome=correct(s,all,p);
 assert.equal(outcome.modified,true);
 assert.equal(all[0].invoiceNo,5952);
 assert.equal(all[0].status,'Đã TT Satori');
 assert.equal(all[0].customerPaidAt,null,'supplier payment must not mark customer paid');
 assert.ok(all[0].satoriPaidAt,'settlement timestamp recorded');
 assert.equal(all[1].status,'Đã thanh toán','same amount must not change other invoice');
 const audit=JSON.parse(outcome.extras.satori_payment_status_audit_v1);
 assert.equal(audit.length,1);assert.equal(audit[0].invoiceNo,5952);
 s.values.satori_payment_status_audit_v1=outcome.extras.satori_payment_status_audit_v1;
 s.revision=171;
 const again=correct(s,all,p);
 assert.equal(again.modified,false,'same requestId is idempotent');
 assert.equal(again.result.duplicate,true);
 failure(()=>correct(s,all,{...p,targetStatus:'Chưa thanh toán'}),'REQUEST_ID_CONFLICT');
}
{
 const all=rows(),s=state(all),p=payload(all[1],{
 requestId:'payment-undo-5923',targetStatus:'Chưa thanh toán',
 reason:'Khôi phục do bot ghi nhầm hóa đơn 5923 thay vì 5952'});
 const outcome=correct(s,all,p);
 assert.equal(outcome.modified,true);
 assert.equal(all[1].status,'Chưa thanh toán');
 assert.equal(all[1].customerPaidAt,null);
 assert.equal(all[0].status,'Chưa thanh toán','same amount untouched');
 assert.equal(JSON.parse(outcome.extras.satori_payment_status_audit_v1)[0].invoiceNo,5923);
}
{
 const all=rows(),s=state(all),p=payload(all[1],{
 requestId:'payment-undo-proof',targetStatus:'Chưa thanh toán',
 reason:'Thử nghiệm từ chối sửa hóa đơn có chứng từ'});
 all[1].customerPaymentReceiptUrl='https://drive.google.com/file/d/fake-proof/view';
 failure(()=>correct(s,all,p),'PAYMENT_PROOF_PROTECTED');
 assert.equal(all[1].status,'Đã thanh toán');
 all[1].customerPaymentReceiptUrl=null;all[1].paymentGroups=[{id:'fake-payment'}];
 failure(()=>correct(s,all,p),'PAYMENT_PROOF_PROTECTED');
}
{
 const all=rows(),s=state(all),p=payload(all[0]);
 failure(()=>correct(s,all,{...p,id:all[1].id}),'INVALID_ORDER');
 failure(()=>correct(s,all,{...p,expectedTotal:1241000}),'ORDER_CHANGED');
 failure(()=>correct(s,all,{...p,expectedCustomerPaidAt:paidAt}),'ORDER_CHANGED');
 failure(()=>correct(s,all,{...p,expectedRevision:169}),'REVISION_CONFLICT');
 failure(()=>correct(s,all,{...p,confirmed:false}),'CONFIRMATION_REQUIRED');
 assert.equal(all[0].status,'Chưa thanh toán');
}
(async()=>{
 const {tools}=await import('../connector/lib/satori.mjs');
 const schema=tools({SATORI_ENABLE_WRITES:'true'})
   .find(x=>x.name==='satori_correct_payment_status');
 assert.ok(schema,'connector exposes correction only when writes enabled');
 assert.equal(schema.inputSchema.properties.expectedCustomerPaidAt.type[1],'null');
 assert.ok(schema.inputSchema.required.includes('expectedCustomerPaidAt'));
 assert.equal(schema.inputSchema.properties.targetStatus.enum.length,2);
 assert.equal(tools({SATORI_ENABLE_WRITES:'false'})
   .some(x=>x.name==='satori_correct_payment_status'),false);
 console.log('PASS: isolated owner correction and connector schema');
})().catch(e=>{console.error(e);process.exitCode=1});
