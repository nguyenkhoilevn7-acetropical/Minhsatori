// Offline browser / Apps Script bridge protocol test. Never touches live invoices.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const js=fs.readFileSync(__dirname+'/../pdf-drive-archive.js','utf8');
const gs=fs.readFileSync(__dirname+'/../api/InvoicePdfArchive.gs','utf8');
const origin='https://n-odiq6uswj4btzrnvxzkeunjxowbbmowt7yh4sqa-0lu-script.googleusercontent.com';
const site='https://nguyenkhoilevn7-acetropical.github.io';
const messages=[], storage=new Map(), browserListeners={}, domListeners={};
const parent={postMessage:(message,target)=>messages.push({message,target})};
const window={__SATORI_DRIVE_APP__:true,parent,__SATORI_DRIVE_READY__:false,
addEventListener:(event,handler)=>{browserListeners[event]=handler;}};
const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
const document={hidden:false,addEventListener:(event,handler)=>{domListeners[event]=handler;}};
const mockBrowser={window,localStorage,document,console,Promise,JSON,Number,Array,Error,
clearTimeout(){},setTimeout(){return 1;},setInterval(){},};
vm.runInNewContext(js,mockBrowser,{filename:'pdf-drive-archive.js'});
assert.equal(messages[0].message.type,'hello');
assert.equal(messages[0].target,origin,'target GAS origin exactly, never a wildcard');
window.satoriArchiveSavedInvoicePdf({id:11,invoiceNo:9001});
assert.deepEqual(JSON.parse(storage.get('satori_pdf_archive_pending_v1')),[{id:'11',invoiceNo:9001}]);
window.satoriArchiveSavedInvoicePdf({id:11,invoiceNo:9001});
assert.equal(JSON.parse(storage.get('satori_pdf_archive_pending_v1')).length,1,'dedupe pending requests');
const capability={channel:'minhsatori-pdf-archive-v1',type:'capabilities',enabled:true};
browserListeners.message({origin:'https://evil.example',source:parent,data:capability});
assert.equal(messages.length,1,'ignore untrusted origin');
browserListeners.message({origin,source:{},data:capability});
assert.equal(messages.length,1,'ignore foreign window');
browserListeners.message({origin,source:parent,data:capability});
const gsWorld={};vm.createContext(gsWorld);vm.runInContext(gs,gsWorld);
const parentListeners={},posted=[],saved=[];
const iframe={postMessage:(m,target)=>posted.push({m,target})};
const f={contentWindow:iframe};
const google={script:{run:{withSuccessHandler(ok){return {withFailureHandler(){
return {satoriSaveInvoicePdf(payload){saved.push(payload);ok({fileId:'fake-drive-pdf-id',invoiceNo:payload.invoiceNo,versionKey:payload.versionKey});}};}};}}}};
const bridge=gsWorld.satoriPdfArchiveBridgeJs_(site);
vm.runInNewContext(bridge,{window:{addEventListener:(event,handler)=>{parentListeners[event]=handler;}},f,google});
parentListeners.message({origin:'https://evil.example',source:iframe,data:{channel:'minhsatori-pdf-archive-v1',type:'put',payload:{invoiceNo:9001}}});
assert.equal(saved.length,0,'reject untrusted child origin');
parentListeners.message({origin:site,source:{},data:{channel:'minhsatori-pdf-archive-v1',type:'put',payload:{invoiceNo:9001}}});
assert.equal(saved.length,0,'reject untrusted child window');
parentListeners.message({origin:site,source:iframe,data:{channel:'minhsatori-pdf-archive-v1',type:'hello'}});
assert.equal(posted[0].m.type,'capabilities');
assert.equal(posted[0].target,site);
const payload={invoiceNo:9001,id:'11',versionKey:'offline-key'};
parentListeners.message({origin:site,source:iframe,data:{channel:'minhsatori-pdf-archive-v1',type:'put',payload}});
assert.equal(saved.length,1);
assert.equal(posted[1].m.type,'stored');
assert.equal(posted[1].m.fileId,'fake-drive-pdf-id');
assert.equal(posted[1].target,site);
console.log('PASS PDF archive postMessage origin checks, sandbox queue persistence, owner bridge ACK');
