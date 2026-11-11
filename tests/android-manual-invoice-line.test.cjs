// Existing Android bill edit: typed row with no catalogue id, saved by orders.update.
// In-memory fake Drive only. The sandbox file id is the code's own isolated gate,
// not a live Google file. No production ledger is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const sandboxId = '1Iemws0kQqpFi1Vt9DGKfVJxBf8zptv0Y';
const catalogue = [{code:'TP-00003',name:'Sản phẩm mẫu 500ml',unit:'Thùng',listPrice:98000}];
const originalItems = [{
  id:'line-catalog',code:'TP-00003',product:'Sản phẩm mẫu 500ml',unit:'Thùng',
  qty:2,unitPrice:73500,listPrice:98000,subtotal:147000
}];
const bill = {
  id:7001,invoiceNo:9101,name:'Khách mẫu',phone:'0900000000',
  location:'Đường mẫu, không giao',date:'01/11/2026',timestamp:1700000000000,
  status:'Chưa thanh toán',total:147000,shippingAmount:0,vatAmount:0,
  goodsTotal:147000,items:originalItems
};

function amount(raw) {
  const value = String(raw).trim();
  if (value === '') return 0;
  if (!/^[0-9]+$/.test(value)) throw new Error('Số lượng và tiền chỉ nhận chữ số.');
  return Number(value);
}
// Same rules as NativeOrderEditor.kt when Kiểm tra & Lưu builds items.
function editorLine(row) {
  const product = String(row.name || '').trim();
  const qty = amount(row.qty);
  const price = amount(row.price);
  if (!(product.length >= 2 && qty >= 1 && qty <= 100000 && price <= 10000000000))
    throw new Error('Thiếu sản phẩm, sai số lượng hoặc đơn giá.');
  let listed = amount(row.listPrice ?? '');
  if (listed === 0) listed = price;
  if (!(listed >= price && listed <= 10000000000))
    throw new Error('Giá niêm yết phải lớn hơn hoặc bằng đơn giá bán.');
  return {
    product, code: row.code || '', qty, unit: String(row.unit || '').trim(),
    unitPrice: price, listPrice: listed
  };
}

const manual = editorLine({
  name:'Nước suối khách đặt riêng', qty:'3', unit:'Thùng', price:'70000', listPrice:'90000'
});
const kept = editorLine({
  name:'Sản phẩm mẫu 500ml', qty:'2', unit:'Thùng', price:'73500', listPrice:'98000',
  code:'TP-00003'
});
assert.equal(manual.code, '');
assert.equal(kept.code, 'TP-00003');

function load(files, drive, props) {
  const context = {
    Date, JSON, Number, String, Array, Object, Error, Math, Set, Map, RegExp, console,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props[key]??''})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    CacheService:{getScriptCache:()=>{
      const cache = new Map();
      return {get:key=>cache.get(key)||null, put:(key,value)=>cache.set(key,value)};
    }},
    ContentService:{MimeType:{JSON:'json'},createTextOutput(text){
      return {body:text,setMimeType(){return this}};
    }},
    Utilities:{
      Charset:{UTF_8:'UTF_8'}, DigestAlgorithm:{SHA_256:'SHA_256'},
      getUuid:()=>'fake-line-'+Math.random().toString(16).slice(2),
      formatDate:()=>'01/11/2026',
      computeDigest:(algo,value)=>{
        assert.equal(algo,'SHA_256');
        return [...crypto.createHash('sha256').update(String(value),'utf8').digest()];
      },
      computeHmacSha256Signature:()=>[]
    },
    DriveApp:{getFileById:(id)=>{
      assert.equal(id, props.STATE_FILE_ID);
      return {
        getBlob:()=>({getDataAsString:()=>drive.raw}),
        makeCopy:()=>({getId:()=>'fake-backup',getBlob:()=>({getDataAsString:()=>drive.raw})}),
        setContent:(next)=>{drive.raw=next;drive.writes++;}
      };
    }},
    UrlFetchApp:{fetch:()=>{throw new Error('network disabled');}}
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(file,'utf8'), context, {filename:file});
  return context;
}

function stored(drive) {
  return JSON.parse(JSON.parse(drive.raw).values.satori_orders_v15);
}
function catalogueOf(drive) {
  return JSON.parse(JSON.parse(drive.raw).values.satori_catalogue_v15);
}

const drive = {writes:0, raw:JSON.stringify({
  revision:3, updatedAt:'2026-11-01T00:00:00Z',
  values:{
    satori_orders_v15:JSON.stringify([bill]),
    satori_trash_bin_v15:'[]',
    satori_deleted_invoice_nos:'[]',
    satori_catalogue_v15:JSON.stringify(catalogue)
  }
})};
const sandbox = load([
  path.join(__dirname,'../android/sandbox/MinhSatori_Mobile_API_Sandbox_Code.gs')
], drive, {STATE_FILE_ID:sandboxId});

function update(requestId, items, total, revision, expectedTotal=147000) {
  return sandbox.SatoriBotApi.executeVerified('orders.update', {
    confirmed:true, requestId, expectedRevision:revision,
    id:7001, invoiceNo:9101, expectedName:'Khách mẫu', expectedTotal,
    order:{
      name:'Khách mẫu', phone:'0900000000', location:'Đường mẫu, không giao',
      items, shippingAmount:0, vatAmount:0, total,
      deliveryNote:'', deliveryDate:''
    }
  }, 'manualrow'+requestId);
}

const firstGoods = 3*70000 + 2*73500;
const saved = update('edit-manual-0001', [manual, kept], firstGoods, 3);
assert.equal(saved.ok, true, JSON.stringify(saved));
assert.equal(saved.revision, 4);
assert.equal(drive.writes, 1);
const rows = stored(drive);
assert.equal(rows.length, 1);
assert.equal(rows[0].id, 7001);
assert.equal(rows[0].invoiceNo, 9101);
assert.equal(rows[0].total, firstGoods);
const lines = rows[0].items;
assert.equal(lines[0].product, 'Nước suối khách đặt riêng');
assert.equal(lines[0].code, '');
assert.equal(lines[0].qty, 3);
assert.equal(lines[0].unit, 'Thùng');
assert.equal(lines[0].unitPrice, 70000);
assert.equal(lines[0].listPrice, 90000);
assert.equal(lines[1].code, 'TP-00003');
assert.equal(lines[1].product, 'Sản phẩm mẫu 500ml');
assert.equal(lines[1].qty, 2);
assert.equal(lines[1].unitPrice, 73500);
assert.deepEqual(catalogueOf(drive), catalogue);

const reloaded = {
  description: lines[0].product || 'Sản phẩm',
  quantity: lines[0].qty,
  unit: lines[0].unit || 'Thùng',
  unitPrice: lines[0].unitPrice,
  listPrice: lines[0].listPrice,
  code: lines[0].code || ''
};
assert.deepEqual(reloaded, {
  description:'Nước suối khách đặt riêng', quantity:3, unit:'Thùng',
  unitPrice:70000, listPrice:90000, code:''
});

const editedManual = editorLine({
  name:'Nước suối khách đặt riêng', qty:'4', unit:'chai', price:'70000', listPrice:'90000'
});
const secondGoods = 4*70000 + 2*73500;
const again = update('edit-manual-0002', [editedManual, kept], secondGoods, 4, firstGoods);
assert.equal(again.ok, true, JSON.stringify(again));
const after = stored(drive)[0].items[0];
assert.equal(after.qty, 4);
assert.equal(after.unit, 'chai');
assert.equal(after.product, 'Nước suối khách đặt riêng');
assert.equal(after.code, '');
assert.equal(stored(drive)[0].items[1].code, 'TP-00003');
assert.deepEqual(catalogueOf(drive), catalogue);

assert.throws(()=>editorLine({name:' ', qty:'1', unit:'Thùng', price:'1', listPrice:'1'}),
  /sản phẩm|đơn giá/i);
assert.throws(()=>editorLine({name:'A', qty:'1', unit:'Thùng', price:'1000', listPrice:'1000'}),
  /sản phẩm|đơn giá/i);
assert.throws(()=>editorLine({name:'Hàng mẫu tay', qty:'0', unit:'Thùng', price:'1000', listPrice:'1000'}),
  /sản phẩm|đơn giá|số lượng/i);
assert.throws(()=>editorLine({name:'Hàng mẫu tay', qty:'1.5', unit:'Thùng', price:'1000', listPrice:'1000'}));
assert.throws(()=>amount('-5'));
const beforeReject = drive.writes;
const openRevision = JSON.parse(drive.raw).revision;
assert.throws(()=>update('edit-manual-0003', [{
  product:'', code:'', qty:1, unit:'Thùng', unitPrice:1000, listPrice:1000
}], 1000, openRevision, secondGoods), error=>error.code==='INVALID_ITEM');
assert.throws(()=>update('edit-manual-0004', [{
  product:'Hàng mẫu tay', code:'', qty:0, unit:'Thùng', unitPrice:1000, listPrice:1000
}], 0, openRevision, secondGoods), error=>error.code==='INVALID_ITEM');
assert.throws(()=>update('edit-manual-0005', [{
  product:'Hàng mẫu tay', code:'', qty:1, unit:'Thùng', unitPrice:-1, listPrice:1000
}], 1000, openRevision, secondGoods), error=>error.code==='INVALID_AMOUNT');
assert.equal(drive.writes, beforeReject);
assert.equal(stored(drive)[0].items[0].product, 'Nước suối khách đặt riêng');
assert.deepEqual(catalogueOf(drive), catalogue);

const editor = fs.readFileSync(path.join(__dirname,
  '../android/app/src/main/java/vn/minhsatori/app/NativeOrderEditor.kt'),'utf8');
assert.match(editor, /\.put\("code",it\.code\)/);
assert.doesNotMatch(editor, /require\([^\n]*it\.code/);
assert.match(editor, /CHỌN HÀNG TỪ DANH MỤC/);
assert.match(editor, /orders\.update/);

// The signed app's production route is AndroidOwnerMobileApi -> BotApi.ownerMobileWrite,
// not the sandbox file. Same typed payload, separate in-memory ledger.
const prodId='14XWSPrxLnKXATwmuHeXGZnCvjDbalghV';
const prodDrive={writes:0,raw:JSON.stringify({
  revision:8,updatedAt:'2026-11-01T00:00:00Z',values:{
    satori_orders_v15:JSON.stringify([JSON.parse(JSON.stringify(bill))]),
    satori_trash_bin_v15:'[]',satori_deleted_invoice_nos:'[]',
    satori_catalogue_v15:JSON.stringify(catalogue)
  }
})};
const prod=load([
  path.join(__dirname,'../api/BotApi.gs'),
  path.join(__dirname,'../api/AndroidOwnerMobileApi.gs')
], prodDrive, {STATE_FILE_ID:prodId,SATORI_ANDROID_OWNER_EMAIL:'owner@example.test',
  SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON:'[]'});
prod.readState_=()=>JSON.parse(prodDrive.raw);
const prodSaved=prod.SatoriBotApi.ownerMobileWrite('orders.update',{
  confirmed:true,requestId:'edit-manual-prod-01',expectedRevision:8,
  id:7001,invoiceNo:9101,expectedName:'Khách mẫu',expectedTotal:147000,
  order:{
    name:'Khách mẫu',phone:'0900000000',location:'Đường mẫu, không giao',
    items:[manual,{...kept}],shippingAmount:0,vatAmount:0,total:firstGoods,
    deliveryNote:'',deliveryDate:''
  }
},'manualprodnonce0001');
assert.equal(prodSaved.revision,9);
const prodLine=stored(prodDrive)[0].items[0];
assert.equal(prodLine.product,'Nước suối khách đặt riêng');
assert.equal(prodLine.code,'');
assert.equal(prodLine.qty,3);
assert.equal(prodLine.unitPrice,70000);
assert.equal(stored(prodDrive)[0].items[1].code,'TP-00003');
assert.deepEqual(catalogueOf(prodDrive),catalogue);
assert.equal(prodDrive.writes,1);

console.log('PASS existing orders.update keeps a typed row on the same bill without a catalogue id');
