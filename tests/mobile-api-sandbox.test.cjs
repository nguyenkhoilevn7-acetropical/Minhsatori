// Isolated sandbox test. Never calls Google or reads real customer data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../android/sandbox/MinhSatori_Mobile_API_Sandbox_Code.gs"), "utf8");
const pinned = source.match(/var SATORI_MOBILE_SANDBOX_FILE_ID = '([^']+)'/);
assert(pinned, "Sandbox pin is required");
assert(source.includes("function doPost(e)"), "Android route required");
assert(source.includes("fileId !== SATORI_MOBILE_SANDBOX_FILE_ID"), "Write guard required");
assert(!source.includes("14XWSPrxLnKXATwmuHeXGZnCvjDbalghV"), "Must never target real Drive file");
const liveId = "production-never-touch";
const owner = "owner@example.test";
const clientId = "123456789-staging.apps.googleusercontent.com";
const cfg = new Map([
  ["STATE_FILE_ID", pinned[1]],
  ["SATORI_ANDROID_OWNER_EMAIL", owner],
  ["SATORI_ANDROID_ALLOWED_CLIENT_IDS_JSON", JSON.stringify([clientId])]
]);
const initial = {
  revision: 1,
  updatedAt: new Date().toISOString(),
  values: {
    satori_orders_v15: JSON.stringify([{id:101,invoiceNo:101,name:"KH GIẢ LẬP SANDBOX",phone:"0900000001",
      location:"101 Đường thử nghiệm",items:[{product:"Nước thử",qty:1,unitPrice:100000}],
      total:100000,status:"Chưa thanh toán",date:"20/10/2026"}]),
    satori_trash_bin_v15:"[]", satori_deleted_invoice_nos:"[]",
    satori_catalogue_v15:"[]", satori_ai_customer_memory:"[]"
  }
};
const states = new Map([[pinned[1], JSON.stringify(initial)], [liveId, "DO_NOT_TOUCH"]]);
const mockFile = (id) => ({
  getBlob: () => ({getDataAsString: () => states.get(id)}),
  getId: () => id,
  makeCopy: () => ({getId: () => "sandbox-backup", getBlob: () => ({getDataAsString: () => states.get(id)})}),
  setContent: (body) => states.set(id, body)
});
let issuedTo = clientId;
let checkedEmail = owner;
let uuidCounter = 0;
const cache = new Map();
const context = {
  console, URLSearchParams,
  PropertiesService: {getScriptProperties: () => ({getProperty: key => cfg.get(key)||null})},
  DriveApp: {getFileById: (id) => {assert(states.has(id)); return mockFile(id);}},
  ContentService: {MimeType: {JSON:"application/json"}, createTextOutput: text => ({
    body: text, setMimeType() {return this;}
  })},
  UrlFetchApp: {fetch: url => url.includes("/tokeninfo?") ? {
    getResponseCode:()=>200,getContentText:()=>JSON.stringify({aud:issuedTo,expires_in:3600,
      scope:"https://www.googleapis.com/auth/userinfo.email"})
  } : {
    getResponseCode:()=>200,getContentText:()=>JSON.stringify({
      email:checkedEmail,email_verified:true,sub:"fake-sub-abc"
    })
  }},
  CacheService: {getScriptCache:()=>({get:key=>cache.get(key),put:(key,val)=>cache.set(key,val)})},
  LockService: {getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
  Utilities: {getUuid:()=>("fake-uuid-"+(++uuidCounter)),formatDate:()=> "20/10/2026"}
};
vm.createContext(context);
vm.runInContext(source, context, {timeout:2500});
const call = (action,payload={},nonce="sandbox_nonce_000000000001") => JSON.parse(
  context.doPost({parameter:{route:"android"},postData:{contents:JSON.stringify({
    kind:"satori-android-v1", action, payload, accessToken:"a".repeat(80),nonce
  })}}).body);
let result = call("mobile.snapshot");
assert(result.ok);
assert.equal(result.data.revision,1);
assert.equal(JSON.parse(result.data.values.satori_orders_v15).length,1);
assert(result.data.allowedActions.includes("orders.create"));
issuedTo = "other-android-client-id";
result = call("mobile.snapshot");
assert.equal(result.ok,false);
assert.equal(result.error.code,"FORBIDDEN");
issuedTo = clientId;
checkedEmail = "unauthorized@example.test";
result = call("mobile.snapshot");
assert.equal(result.ok,false);
assert.equal(result.error.code,"FORBIDDEN");
checkedEmail = owner;
cfg.set("STATE_FILE_ID",liveId);
result = call("mobile.snapshot");
assert.equal(result.ok,false);
assert.equal(states.get(liveId),"DO_NOT_TOUCH");
cfg.set("STATE_FILE_ID",pinned[1]);
const requestId = "sandboxCreateReq20261020";
result = call("orders.create",{
  requestId,expectedRevision:1,confirmedNewCustomer:true,
  order:{name:"KH GIẢ LẬP MOBILE",phone:"0900000009",location:"Địa chỉ giả lập 123",
    items:[{product:"Nước thử nghiệm",qty:1,unitPrice:120000}],total:120000}
},"sandbox_nonce_000000000002");
assert.equal(result.ok,true,JSON.stringify(result.error));
assert.equal(JSON.parse(states.get(pinned[1])).revision,2);
assert.equal(JSON.parse(JSON.parse(states.get(pinned[1])).values.satori_orders_v15).length,2);
assert.equal(states.get(liveId),"DO_NOT_TOUCH");
console.log("PASS: sandbox snapshot, OAuth allowlist, owner check, file pin, fake-only create and backup");
