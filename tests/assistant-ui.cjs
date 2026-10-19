'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const A=require('../satori-assistant.js');
const catalogue=[{code:'TP-00003',brand:'SATORI',name:'Nước tinh khiết Satori 500ml',unit:'Thùng',listPrice:98000,unitPrice:73500}];
const orders=[{id:1,name:'Nhà thuốc Minh Anh',phone:'0901234567',invoiceNo:11,status:'Chưa thanh toán',total:147000}];
function runUi(){
 const make=()=>({style:{},value:'',disabled:false,textContent:'',listeners:{},
  addEventListener(type,fn){this.listeners[type]=fn;}});
 const controls=Object.fromEntries(['satoriAssistantPrompt','satoriAssistantResult','satoriAssistantTransfer','satoriAssistantParse','satoriAssistantDebt'].map(s=>['#'+s,make()]));
 const panel={style:{},querySelector:id=>controls[id],innerHTML:''};
 const anchor={parentElement:{parentElement:{insertBefore(node){assert.equal(node,panel);}}}};
 const fields=Object.fromEntries(['busName','busPhone','busLocation','paymentStatus'].map(s=>[s,make()]));
 let renderCount=0,totalCount=0,scrollCount=0,saveCount=0;
 const context={window:{SatoriOrderAssistant:A},document:{
   createElement:()=>panel,
   getElementById:id=>id==='zaloRawText'?anchor:id==='orderForm'?{scrollIntoView(){scrollCount++;}}:fields[id]||null
  },orders:structuredClone(orders),catalogue:structuredClone(catalogue),currentEditingOrderId:null,
  currentItems:[],renderItemsForm(){renderCount++;},calculateTotals(){totalCount++;},saveOrder(){saveCount++;}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../satori-assistant-ui.js','utf8'),context);
 return {ctx:context,controls,fields,stats:()=>({renderCount,totalCount,scrollCount,saveCount})};
}
test('new assistant panel only prepares draft, does not save invoice or mark customer paid',()=>{
 const {ctx,controls,fields,stats}=runUi();
 controls['#satoriAssistantPrompt'].value='Nhà thuốc Minh Anh, 2 thùng Satori 500ml; địa chỉ: 12 Đường A; 0901234567';
 controls['#satoriAssistantParse'].listeners.click();
 assert.match(controls['#satoriAssistantResult'].textContent,/ĐƠN NHÁP/);
 assert.equal(controls['#satoriAssistantTransfer'].disabled,false);
 assert.equal(ctx.currentItems.length,0);
 controls['#satoriAssistantTransfer'].listeners.click();
 assert.equal(ctx.currentItems.length,1);
 assert.equal(ctx.currentItems[0].qty,2);
 assert.equal(fields.paymentStatus.value,'Chưa thanh toán');
 assert.equal(stats().saveCount,0);
 assert.equal(ctx.orders.length,1);
 assert.equal(controls['#satoriAssistantTransfer'].disabled,true);
});
test('debt question reads records without writes and invalidates stale draft',()=>{
 const {ctx,controls,stats}=runUi();
 controls['#satoriAssistantPrompt'].value='Nhà thuốc Minh Anh, 2 thùng Satori 500ml';
 controls['#satoriAssistantParse'].listeners.click();
 controls['#satoriAssistantPrompt'].value='Nhà thuốc Minh Anh còn bao nhiêu bill chưa thanh toán?';
 controls['#satoriAssistantPrompt'].listeners.input();
 assert.equal(controls['#satoriAssistantTransfer'].disabled,true);
 controls['#satoriAssistantDebt'].listeners.click();
 assert.match(controls['#satoriAssistantResult'].textContent,/147.000đ/);
 assert.equal(ctx.currentItems.length,0);
 assert.equal(stats().saveCount,0);
});
