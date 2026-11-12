import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ownerPdfDownloadPath,prepareOwnerPdfDownload,ownerPdfRefByNumber} from '../owner-pdf-delivery.mjs';

const ref={invoiceNo:98765,ledgerId:'1800000000000'};
const current={id:ref.ledgerId,invoiceNo:ref.invoiceNo,status:'Chưa thanh toán',
 excluded:false,date:'12/11/2026',delivery:{recipientName:'Khách Giả 18+'}};
const bytes=Buffer.from('%PDF-1.7\n'+'.'.repeat(160)+'\n%%EOF');
const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
const fake=async (f=ref,doc=current)=>{
 let readCalls=0,renderCalls=0;
 const actual=await prepareOwnerPdfDownload(f,{
  read:async input=>{assert.deepEqual(input,f);readCalls++;return {revision:250,current:doc}},
  render:async (input,expected)=>{assert.equal(input,doc);assert.deepEqual(expected,f);renderCalls++;
   return {bytes,sha256:checksum}}
 });
 assert.equal(readCalls,1);
 assert.equal(renderCalls,1);
 return actual;
};

test('owner download always uses verified ledger id and native filename, NOT a transient AI file id',async()=>{
 const result=await fake();
 assert.equal(result.filename,'98765 - Khách Giả 18+ - 2026-11-12.pdf');
 assert.equal(result.path,'/api/v2/admin/invoices/98765/1800000000000/pdf');
 assert.equal(result.bytes,bytes,'PDF bytes remain unchanged');
 assert.equal(result.sha256,checksum);
 assert.ok(result.disposition.startsWith('attachment; filename="'));
 assert.ok(result.disposition.includes("filename*=UTF-8''"+encodeURIComponent(result.filename)));
 assert.doesNotMatch(result.filename,/[0-9a-f]{8}-[0-9a-f]{4}-/);
});
test('direct download path rejects unsafe ledger IDs, traversal and invalid invoice numbers',()=>{
 for(const bad of [{invoiceNo:0,ledgerId:'test'},{invoiceNo:98765,ledgerId:'../etc'},
  {invoiceNo:98765,ledgerId:'uuid.pdf'},{invoiceNo:98765,ledgerId:''},
  {invoiceNo:'NaN',ledgerId:'safe'}])
  assert.throws(()=>ownerPdfDownloadPath(bad),/OWNER_PDF_ID_INVALID/);
});
test('strict saved order identity, status, recipient and date - fail closed',async()=>{
 const render=async()=>{throw Error('Render must not run')};
 for(const invalid of [
  {...current,id:'other'}, {...current,invoiceNo:99999},
  {...current,excluded:true},{...current,status:'Đã hủy'},
  {...current,status:'Không Tính'},{...current,date:'31/02/2026'},
  {...current,delivery:{recipientName:''}}
 ]){
  await assert.rejects(prepareOwnerPdfDownload(ref,{
   read:async()=>({revision:3,current:invalid}),render
  }));
 }
});
test('no public PDF or cross-account access: route is AFTER auth and OWNER-only',()=>{
 const source=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 const auth=source.indexOf('const actor=await auth(req,pool)');
 const route=source.indexOf('if((ownerPdfMatch||ownerPdfByNo)&&req.method');
 const next=source.indexOf("if(pathname==='/api/v2/admin/original-invoices'",route);
 assert.ok(auth>0&&route>auth&&next>route);
 const block=source.slice(route,next);
 assert.match(block,/owner\(actor\)/);
 assert.match(block,/readOnlyReady\(\)/);
 assert.match(block,/SATORI_V2_LOCAL_PDFMAKE_ENABLED/);
 assert.match(block,/prepareOwnerPdfDownload/);
 assert.match(block,/cache-control':'private, no-store/);
 assert.match(block,/content-disposition':prepared\.disposition/);
 assert.doesNotMatch(block,/orders\.create|payments\.mark|DriveApp|setSharing/);
});


test('Owner selects invoice by NUMBER from signed ledger, no UUID/phone guessing',async()=>{
 const source={revision:250,data:{totalMatches:1,orders:[
  {id:'1794487403974',invoiceNo:5989,name:'18+',date:'12/11/2026'}
 ]}};
 const actual=await ownerPdfRefByNumber(5989,{reader:async(action,opts)=>{
  assert.equal(action,'orders.list');assert.deepEqual(opts,{query:'5989',limit:100});
  return source;
 }});
 assert.deepEqual(actual,{invoiceNo:5989,ledgerId:'1794487403974'});
});
test('No ambiguous/incomplete signed invoice lookup can serve a file',async()=>{
 const expected=5989;
 const payloads=[
  {revision:4,data:{totalMatches:2,orders:[{id:'x1',invoiceNo:5989},{id:'x2',invoiceNo:5989}]}},
  {revision:4,data:{totalMatches:102,orders:[]}},
  {revision:4,data:{totalMatches:2,orders:[{id:'x1',invoiceNo:5989}]}},
  {revision:4,data:{totalMatches:1,orders:[{id:'../etc',invoiceNo:5989}]}},
  {revision:4,data:{totalMatches:1,orders:[{id:'x1',invoiceNo:5988}]}}
 ];
 for(const payload of payloads){
  await assert.rejects(ownerPdfRefByNumber(expected,{reader:async()=>payload}));
 }
});
test('Owner UI is authenticated and downloads real named PDF, not AI temporary blob',()=>{
 const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
 assert.match(html,/id="ownerPdfForm"/);
 assert.match(html,/id="ownerPdfNo"/);
 assert.match(html,/id="ownerPdfToggle"/);
 assert.match(html,/byId\('ownerPdfToggle'\)\.hidden=false/);
 assert.match(html,/if\(!isOwner\)return/);
 assert.match(html,/fetch\('\/api\/v2\/admin\/invoices\/'\+no\+'\/pdf'/);
 assert.match(html,/filename\*=UTF-8''/);
 assert.match(html,/a\.download=filename/);
 assert.match(html,/magic!=='%PDF-'/);
});
