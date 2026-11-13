const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'api/Retire20L.gs'), 'utf8');
function guard() { const c = {}; vm.createContext(c); vm.runInContext(helper, c); return c; }
function catalogueRuntime() {
  const rows=[], map=new Map(), noop=()=>{};
  const sample={code:'TP-00033',brand:'SATORI',name:'Satori 19L có vòi',spec:'01 bình',unit:'Bình',listPrice:49142,discountPercent:25,unitPrice:36857};
  const c={Blob,console,catalogue:[sample],currentItems:[],currentCatBrandFilter:'ALL',refreshCatalogueMap:noop,
    renderItemsForm:noop,calculateTotals:noop,switchTab:noop,
    document:{getElementById:id=>id==='catalogueTableBody'?{set innerHTML(v){rows.length=0},appendChild:r=>rows.push(r)}:id==='catalogueSearch'?{value:''}:null,
      createElement:tag=>tag==='tr'?{}:{click:noop},body:{appendChild:noop,removeChild:noop}},
    URL:{createObjectURL:blob=>{c.exported=blob;return 'blob:test'}},localStorage:{setItem:(k,v)=>map.set(k,v)}};
  vm.createContext(c);
  const start=html.includes('function cataloguePricing(')?html.indexOf('function cataloguePricing('):html.indexOf('function filterCatalogue(');
  vm.runInContext(html.slice(start,html.indexOf('        function saveCatalogueChanges('))+
    html.slice(html.indexOf('function orderThisCatalogueProduct('),html.indexOf('        async function syncLiveFromGoogleDrive(')),c);
  return {c,rows,sample};
}
test('canonical catalogue renders stored discount and exact unit price without mutating prices',()=>{
  const {c,rows,sample}=catalogueRuntime(),before=JSON.stringify(sample);
  c.renderCatalogueTable();
  assert.match(rows[0].innerHTML,/value="25"/);
  assert.match(rows[0].innerHTML,/36\.857/);
  assert.doesNotMatch(rows[0].innerHTML,/NaN|undefined/);
  assert.equal((rows[0].innerHTML.match(/<td /g)||[]).length,10);
  assert.equal(JSON.stringify(sample),before);
});
test('catalogue price edits use percentage discount and preserve canonical fields',()=>{
  const {c,sample}=catalogueRuntime();
  c.editCatalogueItemDisc('TP-00033','12.5');
  assert.equal(sample.discountPercent,12.5);
  assert.equal(sample.unitPrice,42999);
  c.editCatalogueItemPrice('TP-00033','60000');
  assert.equal(sample.listPrice,60000);
  assert.equal(sample.unitPrice,52500);
});
test('quick add uses the stored 19L unit, price and discount',()=>{
  const {c}=catalogueRuntime();c.orderThisCatalogueProduct('TP-00033');
  assert.equal(c.currentItems[0].unitPrice,36857);
  assert.equal(c.currentItems[0].discountPercent,25);
  assert.equal(c.currentItems[0].unit,'Bình');
  assert.equal(c.currentItems[0].lineTotal,368570);
});
test('reading current or legacy prices preserves exact zero and owner overrides',()=>{
  const {c}=catalogueRuntime();
  assert.equal(c.cataloguePricing({listPrice:49142,discountPercent:25,unitPrice:12345}).unitPrice,12345);
  assert.equal(c.cataloguePricing({listPrice:49142,discountPercent:100,unitPrice:0}).unitPrice,0);
  const old=c.cataloguePricing({listPrice:88000,standardDiscount:22000,defaultUnitPrice:66000});
  assert.equal(old.discountPercent,25);assert.equal(old.unitPrice,66000);
});
test('catalogue export contains canonical percentage and price',async()=>{
  const {c}=catalogueRuntime();c.exportCatalogueCSV();
  const csv=await c.exported.text();
  assert.match(csv,/49142,25,36857/);
  assert.doesNotMatch(csv,/undefined|NaN/);
});
test('cached catalogue drops only 20L and preserves custom 19L prices', () => {
  const map = new Map([['satori_catalogue_v15', JSON.stringify([{code:'TP-00005',name:'20L'}, {code:'TP-00033',name:'19L có vòi',unitPrice:12345}, {code:'TP-00096',name:'19L không vòi',unitPrice:23456}])]]);
  const c = {localStorage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};
  vm.createContext(c);
  vm.runInContext(html.slice(html.indexOf('const DEFAULT_CATALOGUE = '),html.indexOf('// Active Catalogue Brand Filter')),c);
  assert.equal(vm.runInContext('DEFAULT_CATALOGUE.length',c),19);
  assert.equal(vm.runInContext('catalogue.length',c),2);
  assert.equal(vm.runInContext('CATALOGUE_MAP["TP-00033"].unitPrice',c),12345);
  assert.equal(vm.runInContext('CATALOGUE_MAP["TP-00096"].unitPrice',c),23456);
  assert.equal(JSON.parse(map.get('satori_catalogue_v15')).length,2);
});
test('sync blocks new 20L sales including flat legacy invoices', () => {
  const c=guard();
  for(const row of [{id:2,invoiceNo:2,items:[{code:'TP-00005',qty:1}]},{id:2,invoiceNo:2,product:'Satori 20 lít',qty:1}]) {
    assert.throws(()=>c.satoriGuardRetired20L_({satori_orders_v15:JSON.stringify([row])},{satori_orders_v15:'[]'}),/PRODUCT_DISCONTINUED/);
  }
});
test('restoring a backup filters retired stock without changing historical invoices or prices', () => {
  const map = new Map(), noop = () => {};
  const c = {console, localStorage:{setItem:(k,v)=>map.set(k,v)}, document:{getElementById:()=>null},
    STORAGE_KEY:'satori_orders_v15', CATALOGUE_STORAGE_KEY:'satori_catalogue_v15',
    calculateTotals:noop, updateCounters:noop, populateCustomerDatalist:noop,
    populateExcelCustomerFilter:noop, renderTable:noop, renderArchiveInvoices:noop,
    renderCatalogueTable:noop, renderAIMemoryTable:noop, updateTrashBadge:noop, showModal:noop};
  vm.createContext(c);
  vm.runInContext(html.slice(html.indexOf('function isDiscontinued20L('),html.indexOf('// Load or initialize Catalogue'))+
    'let orders=[], catalogue=[], CATALOGUE_MAP={}, nextInvoiceNumber=1;\n'+
    html.slice(html.indexOf('function refreshCatalogueMap('),html.indexOf('        refreshCatalogueMap();'))+
    html.slice(html.indexOf('function executeRestoreData('),html.indexOf('        function backupAllOrdersToGoogleSheets(')),c);
  const rows=[{id:1,invoiceNo:1,items:[{code:'TP-00005',product:'Satori 20L',qty:2}],total:80000}];
  c.executeRestoreData({orders:rows,catalogue:[{code:'TP-00005',name:'Satori 20L'},
    {code:'TP-00033',name:'19L có vòi',unitPrice:12345},{code:'TP-00096',name:'19L không vòi',unitPrice:23456}]});
  assert.deepEqual(JSON.parse(map.get('satori_orders_v15')),rows);
  assert.deepEqual(JSON.parse(map.get('satori_catalogue_v15')).map(p=>[p.code,p.unitPrice]),
    [['TP-00033',12345],['TP-00096',23456]]);
  assert.equal(vm.runInContext('CATALOGUE_MAP["TP-00005"]',c),undefined);
});
test('old invoice payment changes and unchanged trash restoration remain allowed', () => {
  const c=guard(), row={id:1,invoiceNo:1,items:[{code:'TP-00005',qty:2}]};
  const old=JSON.stringify([row]);
  const updated={...row,paid:true};
  c.satoriGuardRetired20L_({satori_orders_v15:JSON.stringify([updated])},{satori_orders_v15:old});
  const previous={satori_orders_v15:'[]',satori_trash_bin_v15:JSON.stringify([{order:row}])};
  c.satoriGuardRetired20L_({satori_orders_v15:old},previous);
  const increased={...row,items:[{code:'TP-00005',qty:3}]};
  assert.throws(()=>c.satoriGuardRetired20L_({satori_orders_v15:JSON.stringify([increased])},previous),/PRODUCT_DISCONTINUED/);
});
test('migration locks, verifies backup, archives only 20L and retains exact invoices', () => {
  let state={revision:251,values:{satori_orders_v15:JSON.stringify([{id:1,invoiceNo:1,product:'20L',qty:2}]),satori_catalogue_v15:JSON.stringify([{code:'TP-00005'},{code:'TP-00033'},{code:'TP-00096'}]),other:'unchanged'}};
  const before=JSON.stringify(state); let locked=false,backs=0,writes=0;
  const file={makeCopy(){assert(locked);backs++;const snapshot=JSON.stringify(state);return{getBlob:()=>({getDataAsString:()=>snapshot}),getId:()=> 'backup'}},setContent(v){assert(locked);writes++;state=JSON.parse(v)}};
  const c={console:{log(){}},requireOwner_(){},readState_:()=>JSON.parse(JSON.stringify(state)),LockService:{getScriptLock:()=>({waitLock(){locked=true},releaseLock(){locked=false}})},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'live'})},DriveApp:{getFileById:()=>file}};
  vm.createContext(c);vm.runInContext(helper,c);
  const r=c.satoriRetire20LApply();assert.equal(r.active,2);assert(r.ordersUnchanged);assert.equal(backs,1);assert.equal(writes,1);
  assert.equal(state.values.satori_orders_v15,JSON.parse(before).values.satori_orders_v15);assert.equal(state.values.other,'unchanged');
  c.satoriRetire20LApply();assert.equal(writes,1);
});
test('form blocks a new or duplicated 20L invoice before any save', () => {
  const start=html.indexOf('function handleSaveAndGenerate('),sub=html.slice(start),next=/\n\s*function\s+[a-zA-Z_$][\w$]*\s*\(/g;next.lastIndex=16;const end=next.exec(sub);
  let message='';const c={window:{},orders:[],currentEditingOrderId:null,currentItems:[{code:'TP-00005',qty:1}],showModal:title=>message=title};
  vm.createContext(c);vm.runInContext(helper+'\nfunction retired20LQuantity(items){return items.filter(satoriIsRetired20L_).reduce((s,i)=>s+Number(i.qty||0),0)}\n'+sub.slice(0,end.index),c);
  c.handleSaveAndGenerate();assert.equal(message,'Sản phẩm đã ngừng bán');
});
