import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeInvoiceLines,saveInvoiceLineDraft,readInvoiceLineDraft,
 InvoiceLineError} from '../invoice-line-editor.mjs';

const ownerId='a0000000-1111-4111-8111-0000000000aa';
const catalogue=Object.freeze([
 {code:'TP-00003',name:'Sản phẩm mẫu 500ml',unit:'Thùng',listPrice:98000}
]);
const manual={name:'Nước suối khách đặt riêng',qty:3,unit:'Thùng',unitPrice:70000,listPrice:90000};
const catalogLine={name:'Sản phẩm mẫu 500ml',qty:2,unit:'Thùng',unitPrice:73500,
 listPrice:98000,productId:'TP-00003'};

function message(input){
 try{normalizeInvoiceLines(input,catalogue);return '';}
 catch(e){return e.message;}
}

test('manual-only line saves name, quantity, unit and price without a catalogue id',()=>{
 const draft=normalizeInvoiceLines({lines:[manual]},catalogue);
 assert.equal(draft.lines.length,1);
 assert.equal(draft.lines[0].productId,null);
 assert.equal(draft.lines[0].name,manual.name);
 assert.equal(draft.lines[0].qty,3);
 assert.equal(draft.lines[0].unit,'Thùng');
 assert.equal(draft.lines[0].unitPrice,70000);
 assert.equal(draft.lines[0].listPrice,90000);
 assert.equal(draft.lines[0].lineTotal,210000);
 assert.equal(draft.goodsVnd,210000);
 assert.equal(draft.totalVnd,210000);
 assert.equal(catalogue.length,1);
});

test('a manual name that matches the catalogue is not assigned a product id',()=>{
 const draft=normalizeInvoiceLines({lines:[{
  name:'Sản phẩm mẫu 500ml',qty:1,unit:'Thùng',unitPrice:50000,listPrice:50000
 }]},catalogue);
 assert.equal(draft.lines[0].productId,null);
 assert.equal(draft.lines[0].name,'Sản phẩm mẫu 500ml');
 assert.equal(catalogue.length,1);
});

test('mixed invoice keeps catalogue and manual rows and totals both',()=>{
 const draft=normalizeInvoiceLines({lines:[manual,catalogLine]},catalogue);
 assert.equal(draft.lines[0].productId,null);
 assert.equal(draft.lines[1].productId,'TP-00003');
 assert.equal(draft.lines[1].unitPrice,73500);
 assert.equal(draft.goodsVnd,210000+147000);
 assert.equal(draft.totalVnd,357000);
});

test('invalid name, quantity and price return Vietnamese errors',()=>{
 assert.match(message({lines:[{...manual,name:'  '}]}),/tên sản phẩm/i);
 assert.match(message({lines:[{...manual,name:'A'}]}),/tên sản phẩm/i);
 assert.match(message({lines:[{...manual,qty:0}]}),/Số lượng/);
 assert.match(message({lines:[{...manual,qty:1.5}]}),/Số lượng/);
 assert.match(message({lines:[{...manual,qty:'3'}]}),/Số lượng/);
 assert.match(message({lines:[{...manual,unitPrice:-1}]}),/Đơn giá/);
 assert.match(message({lines:[{...manual,unitPrice:10.5}]}),/Đơn giá/);
 assert.match(message({lines:[{...manual,listPrice:1000}]}),/Giá niêm yết/);
 assert.match(message({lines:[{...manual,productId:'TP-99999'}]}),/danh mục/);
 assert.match(message({lines:[{...manual,unit:''}]}),/Đơn vị/);
});

function fakePool(){
 const journal=[];
 const sqlLog=[];
 const conn={
  async query(sql,args=[]){
   sqlLog.push(sql);
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
   if(sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[]};
   if(sql.includes('FROM satori_v2_catalogue'))
    return {rows:catalogue.map(x=>({...x}))};
   if(sql.startsWith('SELECT details, account_id')){
    const id=args[1];
    const rows=journal.filter(x=>x.resourceId===id);
    return {rows:rows.length?[rows[rows.length-1]]:[]};
   }
   if(sql.startsWith('INSERT INTO satori_v2_audit')){
    journal.push({accountId:args[0],resourceId:args[3],details:JSON.parse(args[4])});
    return {rows:[]};
   }
   throw Error('Unexpected SQL '+sql);
  },
  release(){}
 };
 return {pool:{async connect(){return conn}},journal,sqlLog};
}

test('edit then reload preserves manual values and does not create a catalogue product',async()=>{
 const {pool,journal,sqlLog}=fakePool();
 const created=await saveInvoiceLineDraft(pool,{id:ownerId},{
  confirmed:true,expectedRevision:0,lines:[manual,catalogLine]
 });
 assert.equal(created.revision,1);
 assert.equal(created.lines[0].productId,null);
 assert.equal(created.lines[0].name,manual.name);
 assert.equal(created.totalVnd,357000);
 const opened=await readInvoiceLineDraft(pool,{id:ownerId},created.id);
 assert.equal(opened.lines[0].unit,'Thùng');
 assert.equal(opened.lines[0].listPrice,90000);
 assert.equal(opened.lines[1].productId,'TP-00003');
 const edited=await saveInvoiceLineDraft(pool,{id:ownerId},{
  confirmed:true,id:created.id,expectedRevision:1,
  lines:[{...manual,qty:4},catalogLine]
 });
 assert.equal(edited.revision,2);
 assert.equal(edited.lines[0].qty,4);
 assert.equal(edited.lines[0].name,manual.name);
 assert.equal(edited.lines[0].productId,null);
 assert.equal(edited.goodsVnd,4*70000+147000);
 const again=await readInvoiceLineDraft(pool,{id:ownerId},created.id);
 assert.equal(again.lines[0].qty,4);
 assert.equal(again.lines[1].unitPrice,73500);
 assert.equal(sqlLog.some(sql=>/INSERT INTO satori_v2_catalogue/i.test(sql)),false);
 assert.equal(journal.length,2);
 await assert.rejects(()=>saveInvoiceLineDraft(pool,{id:ownerId},{
  confirmed:true,id:created.id,expectedRevision:1,lines:[manual]
 }),error=>error instanceof InvoiceLineError&&/mở lại/.test(error.message));
});

test('owner editor serializes a manual row without a product id and keeps catalogue rows',()=>{
 const owner=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
 assert.match(owner,/Tên sản phẩm/);
 assert.match(owner,/Số lượng/);
 assert.match(owner,/Đơn vị/);
 assert.match(owner,/Đơn giá/);
 assert.match(owner,/Giá niêm yết/);
 assert.match(owner,/Chọn hàng từ danh mục/);
 assert.match(owner,/Xóa sản phẩm này/);
 assert.match(owner,/\+Thêm sản phẩm/);
 assert.match(owner,/Kiểm tra & Lưu/);
 const script=owner.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
 assert.doesNotThrow(()=>new vm.Script(script));
 const start=script.indexOf('function serializeInvoiceEditorRows');
 const end=script.indexOf('function invoiceEditorGoods');
 assert.ok(start>0&&end>start);
 const serialize=new Function(`${script.slice(start,end)} return serializeInvoiceEditorRows;`)();
 const rows=serialize([
  {name:'  Nước suối khách đặt riêng ',qty:'3',unit:' Thùng ',unitPrice:'70000',
   listPrice:'90000',productId:'TP-00003',catalogName:'Sản phẩm mẫu 500ml'},
  {name:'Sản phẩm mẫu 500ml',qty:'2',unit:'Thùng',unitPrice:'73500',
   listPrice:'98000',productId:'TP-00003',catalogName:'Sản phẩm mẫu 500ml'}
 ]);
 assert.equal(rows[0].productId,null);
 assert.equal(rows[0].name,'Nước suối khách đặt riêng');
 assert.equal(rows[0].qty,3);
 assert.equal(rows[0].unit,'Thùng');
 assert.equal(rows[0].unitPrice,70000);
 assert.equal(rows[1].productId,'TP-00003');
 const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
 assert.match(router,/\/api\/v2\/admin\/invoice-line-draft/);
 assert.match(router,/owner\(actor\)/);
 assert.doesNotMatch(router,/invoice-line-draft[\s\S]{0,500}orders\.create/);
});
