/* TEST-only HTTP E2E for conversational amendments to an already confirmed invoice.
 * No real customer, live API key, production Drive or shipping update.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isAmendmentIntent,parseAmendment,isConfirmAmend,appendDeliveryNote} from '../order-amend.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(path.join(tmpdir(),'satori-amend-test-'));
const port=31000+Math.floor(Math.random()*1200),base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{
 env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',
 DEMO_DATA_DIR:dir,GEMINI_API_KEY:'',SATORI_READ_ENDPOINT:'',SATORI_READ_KEY_ID:'',
 SATORI_READ_HMAC_SECRET:''},stdio:['ignore','pipe','pipe']});
let bootDiagnostic='';
proc.stdout.on('data',x=>{bootDiagnostic+=String(x).slice(0,1200)});
proc.stderr.on('data',x=>{bootDiagnostic+=String(x).slice(0,1200)});
const sleep=t=>new Promise(r=>setTimeout(r,t));
const ask=async(uri,body)=>{
 const r=await fetch(base+uri,{method:body?'POST':'GET',
 headers:body?{'content-type':'application/json'}:{},
 body:body?JSON.stringify(body):undefined});
 const bytes=Buffer.from(await r.arrayBuffer());let result;
 try{result=JSON.parse(bytes.toString('utf8'))}catch{result={}};
 return {status:r.status,result,bytes};
};
let count=0;const check=(value,label)=>{assert.ok(value,label);count++};
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await ask('/health')).status===200){ready=true;break}}catch{}await sleep(85)}
 check(ready,'isolated Node server boots with no AI credentials; '+bootDiagnostic.slice(-1500));
 check(isAmendmentIntent('Sửa hóa đơn vừa đặt giao sau hai giờ'),'understands a confirmed-order delivery-note change');
 check(!isAmendmentIntent('Cho tôi 10 thùng Satori 500ml giao sau 2 giờ chiều'),'new product order is never mistaken for amendment');
 check(isConfirmAmend('Đúng rồi'),'explicit Vietnamese confirmation');
 check(appendDeliveryNote('Gọi trước','Giao sau 14:00').includes('Gọi trước'),'old note is preserved');
 const token='demo-a';
 const first=await ask('/api/message',{token,message:'Cho tôi 2 thùng Satori 500ml'});
 check(first.status===200&&first.result.quote?.qty===2,'sandbox item quoted');
 const confirmed=await ask('/api/confirm',{token,quoteId:first.result.quote.quoteId,requestId:'demo-amend-confirm-001',
  deliveryNote:'Nhớ gọi trước khi giao'});
 const ref=confirmed.result.order?.ref,total=confirmed.result.order?.total;
 check(confirmed.status===200&&/^TEST-[A-F0-9]{10}$/.test(ref),'one sandbox TEST invoice created');
 const originalPdf=await ask('/api/invoice/'+ref+'?token='+token);
 check(originalPdf.status===200&&originalPdf.bytes.subarray(0,4).toString()==='%PDF','original PDF created');
 const wrongRef=await ask('/api/message',{token,message:'Sửa hóa đơn TEST-FFFFFFFFFF giao sau 2 giờ chiều'});
 check(wrongRef.result.needsHuman===true&&!wrongRef.result.editProposal,'explicitly referenced wrong invoice is refused');
 const ambiguous=await ask('/api/message',{token,message:'Em muốn sửa hóa đơn vừa đặt giao sau hai giờ'});
 check(ambiguous.status===200&&ambiguous.result.needMoreDetails===true&&
  /chiều|tiếng/.test(ambiguous.result.message),'ambiguous time requires clarification, no silent 2am/2pm');
 let history=await ask('/api/history?token='+token);
 check(history.result.orders[0].deliveryNote==='Nhớ gọi trước khi giao','ambiguous utterance never edits invoice');
 const clarified=await ask('/api/message',{token,message:'2 giờ chiều'});
 const proposal=clarified.result.editProposal;
 check(clarified.status===200&&proposal?.ref===ref&&proposal?.newNote.includes('14:00'),
  'confirmation proposal targets same invoice and correct 14:00 time');
 check(proposal.previousNote==='Nhớ gọi trước khi giao'&&proposal.newNote.includes('Nhớ gọi trước'),
  'proposal displays prior note and adds delivery note');
 const pendingHistory=await ask('/api/history?token='+token);
 check(pendingHistory.result.orders[0].deliveryNote==='Nhớ gọi trước khi giao',
  'proposal alone must not modify persisted history');
 const denied=await ask('/api/order-amend/confirm',{token,proposalId:proposal.proposalId});
 check(denied.status===400&&denied.result.error==='CONFIRMATION_REQUIRED',
  'unconfirmed button call cannot update');
 const cross=await ask('/api/order-amend/confirm',{token:'demo-b',proposalId:proposal.proposalId,confirmed:true});
 check(cross.status!==200,'another customer cannot approve different invoice');
 const accepted=await ask('/api/order-amend/confirm',{token,proposalId:proposal.proposalId,confirmed:true});
 check(accepted.status===200&&accepted.result.amended===true&&accepted.result.order.ref===ref,
  'explicit approval updates original TEST invoice');
 check(accepted.result.order.total===total&&accepted.result.order.qty===2&&
  accepted.result.order.deliveryNote.includes('14:00'),'amount and SKUs untouched');
 const retry=await ask('/api/order-amend/confirm',{token,proposalId:proposal.proposalId,confirmed:true});
 check(retry.status===200&&retry.result.duplicate===true,'double-click idempotent');
 history=await ask('/api/history?token='+token);
 check(history.result.count===1&&history.result.orders[0].ref===ref&&
  history.result.orders[0].deliveryNote.includes('14:00'),'history updated without creating another order');
 const persisted=JSON.parse(readFileSync(path.join(dir,'orders.json'),'utf8'));
 check(persisted.length===1&&persisted[0].amendmentVersion===1&&persisted[0].lastAmendmentId===proposal.proposalId,
  'amendment persisted atomically without duplicate invoice');
 const changedPdf=await ask('/api/invoice/'+ref+'?token='+token);
 check(changedPdf.status===200&&changedPdf.bytes.subarray(0,4).toString()==='%PDF'&&
  !originalPdf.bytes.equals(changedPdf.bytes),'original PDF endpoint re-renders updated delivery note');
 const xlsx=await ask('/api/history.xlsx?token='+token);
 const extract=spawnSync('python3',['-c',
  "import sys,zipfile,io; print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('xl/worksheets/sheet1.xml').decode())"],
  {input:xlsx.bytes,encoding:'utf8'});
 check(xlsx.status===200&&extract.status===0&&extract.stdout.includes('14:00'),
  'Excel export contains amended delivery instructions');
 const noDouble=await ask('/api/message',{token,message:'Giao sau 2 giờ chiều'});
 check(noDouble.result.message?.includes('đã có ghi chú'),'same note does not append repeatedly');
 const additional=await ask('/api/message',{token,message:'Sửa hóa đơn vừa rồi, nhớ để ở quầy lễ tân'});
 check(additional.result.editProposal?.ref===ref,'new delivery note can be amended again');
 const stop=await ask('/api/message',{token,message:'Không sửa'});
 check(stop.result.amendmentCancelled===true,'text cancellation leaves order unchanged');
 history=await ask('/api/history?token='+token);
 check(history.result.orders[0].deliveryNote===accepted.result.order.deliveryNote,'cancel leaves unchanged');
 const next=await ask('/api/message',{token,message:'Sửa hóa đơn vừa đặt, nhớ để ở quầy lễ tân'});
 check(next.result.editProposal?.ref===ref,'fresh note asks permission again');
 const yes=await ask('/api/message',{token,message:'Đúng rồi'});
 check(yes.result.amended===true&&yes.result.order.ref===ref,'typed confirmation updates same invoice');
 check(yes.result.order.amendmentVersion===2,'second distinct amendment advances revision');
 const crossPdf=await ask('/api/invoice/'+ref+'?token=demo-b');
 check(crossPdf.status===404,'other customer cannot view updated invoice PDF');
 const newTime=await ask('/api/message',{token,message:'Sửa hóa đơn vừa đặt giao sau 3 giờ chiều'});
 check(newTime.result.editProposal?.newNote.includes('15:00'),'new requested time is offered for consent');
 const approveNewTime=await ask('/api/message',{token,message:'Vâng'});
 check(approveNewTime.result.amended===true&&approveNewTime.result.order.deliveryNote.includes('15:00'),
  'customer can accept updated time with natural Vietnamese confirmation');
 check(!approveNewTime.result.order.deliveryNote.includes('14:00')&&
  approveNewTime.result.order.amendmentVersion===3,'new delivery time replaces old request instead of contradicting it');
 check((await ask('/health')).result.orders===1,'still exactly one TEST invoice after two edits');
 console.log('PASS '+count+'/'+count+' conversational post-confirm invoice amendments, PDF, XLSX, isolation and idempotency');
}catch(e){console.error('FAIL '+e.stack);process.exitCode=1}
finally{proc.kill();rmSync(dir,{recursive:true,force:true})}
