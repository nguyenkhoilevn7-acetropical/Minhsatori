/* Offline tests for the real website bot. No Google Drive or live orders are changed. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../satori-bot-live.js'),'utf8');
const fixture={id:1792321842277,invoiceNo:5923,date:'18/10/2026',timestamp:1792321842277,
  name:'CÔNG TY CP VINAHASA (Ốc Q)',phone:'0900000000',location:'Địa chỉ mẫu',
  taxCode:'',vat:'yes',costDiscountPercent:45,items:[{code:'TP-00051',
  product:'Nước tinh khiết Satori Premium 450ml',unit:'Thùng',qty:10,listPrice:137963,
  unitPrice:115000,discountPercent:16.64}]};
const older={...fixture,id:51,invoiceNo:51,date:'18/09/2026',timestamp:0,name:'Ốc Q'};
const catalogue=[{code:'TP-00051',unit:'Thùng',name:'Nước tinh khiết Satori Premium 450ml'}];
function setup(rows=[older,fixture],connected=true){
 const els=new Map();
 const element=id=>{if(!els.has(id))els.set(id,{value:'',title:'',hidden:false,style:{display:'none'},
  getAttribute(){return this.title},setAttribute(){},scrollIntoView(){},remove(){},focus(){},classList:{add(){},remove(){}}});return els.get(id)};
 element('driveSyncDot').title=connected?'Đã đồng bộ Google Drive · bản 90 · 111 bản ghi':'Chưa lưu lên Drive';
 element('driveLoadingCover').style.display='none';
 const storage={satori_orders_v15:JSON.stringify(rows)};
 const localStorage={getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v};
 const document={readyState:'loading',addEventListener(){},getElementById:element,
  createElement:()=>({style:{},setAttribute(){},remove(){}}),
  body:{style:{},appendChild(){}},head:{appendChild(){}}};
 const win={__SATORI_DRIVE_APP__:true};
 const code=src.replace('root.SatoriBotParser={',
  'root.__tests={applyToForm:applyToForm,buildDraft:buildDraft,cloudSynced:cloudSynced};root.SatoriBotParser={');
 const prefix=String.raw`
  var currentEditingOrderId=null,currentItems=[],nextInvoiceNumber=5924,isManualProfitOverride=false;
  var catalogue=[{code:'TP-00051',unit:'Thùng'}];
  var calls={saved:0};
  function renderItemsForm(){}
  function calculateTotals(){}
  function switchTab(){}
  function handleSaveAndGenerate(){
    calls.saved++;
    var all=JSON.parse(localStorage.getItem('satori_orders_v15'));
    var goods=currentItems.reduce((n,i)=>n+i.qty*i.unitPrice,0);
    all.unshift({invoiceNo:Number(document.getElementById('invoiceNo').value),
      name:document.getElementById('busName').value,items:currentItems,total:goods+Math.round(goods*.08),
      botRequestId:window.__satoriBotSaveMeta.requestId,
      deliveryDate:window.__satoriBotSaveMeta.deliveryDate,status:document.getElementById('paymentStatus').value});
    localStorage.setItem('satori_orders_v15',JSON.stringify(all));
  }
 `;
 const factory=new Function('window','globalThis','document','localStorage','setTimeout','setInterval','confirm',
  prefix+code+';return {api:window.__tests,calls:calls,setEdit:x=>{currentEditingOrderId=x}}');
 const runtime=factory(win,win,document,localStorage,()=>0,()=>0,()=>true);
 return {...runtime,element,rows:()=>JSON.parse(localStorage.getItem('satori_orders_v15')),win};
}
test('understands abbreviated delivery message and chooses the newest customer alias',()=>{
 const r=setup(),d=r.api.buildDraft('Mai giao e Ốc Q\n10T suoi',r.rows(),catalogue,new Date(2026,9,19));
 assert.equal(d.customer,fixture.name);assert.equal(d.referenceNo,5923);assert.equal(d.qty,10);
 assert.equal(d.price,115000);assert.equal(d.deliveryDate,'2026-10-20');
 assert.equal(d.vat,'yes');assert.equal(d.total,1242000);assert.equal(d.ready,true);
});
test('never treats unknown products, wrong volumes or unknown customers as ready',()=>{
 for(const msg of ['Mai giao e Ốc Q\n10T coca','Mai giao e Ốc Q\n10T suoi 500ml',
  'Mai giao e Khách mới\n10T suoi','Mai giao e Ốc Q\n10T suoi, tổng tiền 1000000']){
  const r=setup(),d=r.api.buildDraft(msg,r.rows(),catalogue,new Date(2026,9,19));assert.equal(d.ready,false,msg);
 }
});
test('applies Bot draft through existing save callback and keeps delivery metadata',()=>{
 const r=setup(),d=r.api.buildDraft('Mai giao e Ốc Q\n10T suoi',r.rows(),catalogue,new Date(2026,9,19));
 r.element('satori-bot-qty').value='10';r.element('satori-bot-unitprice').value='115000';
 r.element('satori-bot-vat').value='yes';r.element('satori-bot-delivery').value='2026-10-20';
 const n=r.rows().length,out=r.api.applyToForm(d,true),saved=r.rows()[0];
 assert.equal(out.saved,true);assert.equal(r.calls.saved,1);assert.equal(r.rows().length,n+1);
 assert.equal(saved.total,1242000);assert.equal(saved.invoiceNo,5924);
 assert.equal(saved.status,'Chưa thanh toán');assert.equal(saved.deliveryDate,'2026-10-20');
 assert.equal(r.win.__satoriBotSaveMeta,undefined);
});
test('blocks writes if cloud not synced or an existing invoice is being edited',()=>{
 const r=setup([older,fixture],false),d=r.api.buildDraft('Mai giao e Ốc Q\n10T suoi',r.rows(),catalogue,new Date(2026,9,19));
 r.element('satori-bot-qty').value='10';r.element('satori-bot-unitprice').value='115000';
 r.element('satori-bot-vat').value='yes';r.element('satori-bot-delivery').value='2026-10-20';
 assert.throws(()=>r.api.applyToForm(d,true),/Google Drive/);assert.equal(r.calls.saved,0);
 r.element('driveSyncDot').title='Đã đồng bộ Google Drive · bản 90';
 r.setEdit(55);assert.throws(()=>r.api.applyToForm(d,true),/Đang sửa hóa đơn cũ/);
 assert.equal(r.calls.saved,0);
});
