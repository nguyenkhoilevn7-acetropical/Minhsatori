const SEED_BACKUP_ID = 'REDACTED_SEED_BACKUP_FILE_ID';
const OWNER_EMAIL = 'REDACTED_OWNER_EMAIL@example.invalid';
const APP_URL = 'https://nguyenkhoilevn7-acetropical.github.io/Minhsatori/?driveBuild=20261113-retire20l';
function requireOwner_() {
  if (Session.getActiveUser().getEmail().toLowerCase() !== OWNER_EMAIL) throw Error('Vui lòng đăng nhập đúng tài khoản Google quản lý Minh Satori.');
}
function setupDrive() {
  requireOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const p = PropertiesService.getScriptProperties();
    if (p.getProperty('STATE_FILE_ID')) return readState_();
    const backup = JSON.parse(DriveApp.getFileById(SEED_BACKUP_ID).getBlob().getDataAsString());
    const d = backup.data;
    if (!d || !Array.isArray(d.orders) || d.orders.length !== 102) throw Error('Bản sao khởi tạo chưa đúng 102 bản ghi.');
    const values = {
      satori_orders_v15: JSON.stringify(d.orders.map((o,i) => Object.assign({},o,{__syncId:'initial-'+i+'-'+o.id}))),
      satori_catalogue_v15: JSON.stringify(d.catalogue),
      satori_ai_customer_memory: JSON.stringify(d.aiMemory),
      satori_trash_bin_v15: JSON.stringify(d.trashBin || []),
      satori_deleted_invoice_nos: JSON.stringify(d.deletedNos || []),
      satori_app_version: 'v6.0_stable_pro',
      satori_system_default_cost_discount: '45'
    };
    const state = {revision:1,values:values,updatedAt:new Date().toISOString()};
    const file = DriveApp.createFile('MinhSatori_Live_Data.json',JSON.stringify(state),MimeType.PLAIN_TEXT);
    p.setProperty('STATE_FILE_ID',file.getId());
    return {revision:state.revision,orders:d.orders.length};
  } finally {lock.releaseLock();}
}
function readState_() {
  const id = PropertiesService.getScriptProperties().getProperty('STATE_FILE_ID');
  if (!id) throw Error('Chạy setupDrive trước khi sử dụng.');
  return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
}
function driveRead() {requireOwner_();return readState_();}
function same_(a,b) {return JSON.stringify(a) === JSON.stringify(b);}
function mergeRows_(base,local,remote,keyField) {
  const index = rows => {
    const map = {}, counts = {};
    rows.forEach(o => {
      let key = String(o.__syncId || o[keyField]);
      if (key === 'undefined') throw Error('Bản ghi thiếu mã định danh.');
      const n = counts[key] || 0; counts[key] = n+1;
      key += '~'+n; map[key] = o;
    }); return map;
  };
  const b=index(base),l=index(local),r=index(remote),out=Object.assign({},r);
  Object.keys(Object.assign({},b,l)).forEach(key => {
    if (same_(b[key],l[key])) return;
    if (!same_(r[key],b[key]) && !same_(r[key],l[key])) throw Error('Có hai thiết bị sửa cùng một bản ghi. Đã giữ cả bản trên máy và trên Drive để đối chiếu.');
    if (l[key] === undefined) delete out[key]; else out[key] = l[key];
  });
  return Object.values(out);
}
function mergeValues_(base,local,remote) {
  const out=Object.assign({},remote);
  Object.keys(Object.assign({},base,local)).forEach(key => {
    if (!/^satori_/.test(key) || key.length>120 || /cloud_|drive_bridge_|orders_recovery_before_/.test(key)) return;
    if (base[key]===local[key]) return;
    if (remote[key]===base[key] || remote[key]===local[key]) {
      if (local[key] === undefined) delete out[key]; else out[key]=local[key];
      return;
    }
    const field=key==='satori_orders_v15'?'id':key==='satori_catalogue_v15'?'code':key==='satori_ai_customer_memory'?'id':null;
    if (!field) throw Error('Cài đặt đã đổi trên thiết bị khác. Dữ liệu chưa bị ghi đè.');
    out[key]=JSON.stringify(mergeRows_(JSON.parse(base[key]||'[]'),JSON.parse(local[key]||'[]'),JSON.parse(remote[key]||'[]'),field));
  });
  if (!Array.isArray(JSON.parse(out.satori_orders_v15))) throw Error('Dữ liệu hóa đơn không hợp lệ.');
  return out;
}
function driveCommit(request) {
  requireOwner_();
  if (!request || !request.base || !request.local || JSON.stringify(request).length>4000000) throw Error('Yêu cầu đồng bộ không hợp lệ.');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    const state=readState_();
    const values=mergeValues_(request.base,request.local,state.values);
    satoriGuardRetired20L_(values,state.values);
    if (same_(values,state.values)) return state;
    const p=PropertiesService.getScriptProperties(),file=DriveApp.getFileById(p.getProperty('STATE_FILE_ID'));
    const day=new Date().toISOString().slice(0,10);
    if(p.getProperty('LAST_BACKUP_DAY')!==day) {
      file.makeCopy('MinhSatori_Auto_Backup_'+day);
      p.setProperty('LAST_BACKUP_DAY',day);
    }
    const next={revision:state.revision+1,values:values,updatedAt:new Date().toISOString()};
    file.setContent(JSON.stringify(next));
    const checked=readState_();
    if (!same_(checked,next)) throw Error('Chưa xác nhận được dữ liệu đã lưu.');
    return checked;
  } finally {lock.releaseLock();}
}
function doGet() {
  requireOwner_();
  const appOrigin='https://nguyenkhoilevn7-acetropical.github.io';
  const html='<!doctype html><html><head><base target="_top"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe id="app" title="Minh Satori" style="border:0;width:100vw;height:100dvh" allow="web-share; clipboard-write" src="'+APP_URL+'&driveLoad='+Date.now()+'#satori-drive=1"></iframe><script>'+ 
    'const f=document.getElementById("app");let busy=false;window.addEventListener("message",e=>{if(e.origin!=='+JSON.stringify(appOrigin)+'||e.source!==f.contentWindow||!e.data||e.data.channel!=="minhsatori-drive-v1"||busy)return;const m=e.data;if(!["read","commit"].includes(m.type))return;busy=true;const ok=s=>{busy=false;f.contentWindow.postMessage({channel:"minhsatori-drive-v1",type:"state",id:m.id,state:s},'+JSON.stringify(appOrigin)+');};const fail=x=>{busy=false;f.contentWindow.postMessage({channel:"minhsatori-drive-v1",type:"error",id:m.id,error:String(x.message||x)},'+JSON.stringify(appOrigin)+');};const r=google.script.run.withSuccessHandler(ok).withFailureHandler(fail);if(m.type==="read")r.driveRead();else r.driveCommit(m.request);});' +
    satoriPdfArchiveBridgeJs_(appOrigin) +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Minh Satori · Google Drive').addMetaTag('viewport','width=device-width, initial-scale=1');
}