/** 
 * Minh Satori — stand-alone, isolated HTTP payment sandbox environment.
 *
 * INSTALL ONLY IN A BRAND NEW Apps Script project with the matching,
 * commit-pinned api/BotApi.gs (which provides SatoriBotApi + doPost).
 * DO NOT install in the working V18.3 production project or the existing
 * MinhSatori_Bot_Write_Sandbox_ONLY project: both have their own doPost.
 *
 * This file is NEVER deployed by a GitHub merge.
 */
var SATORI_HTTP_FAKE_MARKER = 'SATORI_HTTP_PAYMENT_FAKE_FIXTURE_V1';
var SATORI_HTTP_FAKE_NAME = 'SATORI_PAYMENT_HTTP_FAKE_ONLY.json';

function setupIsolatedPaymentHttpSandbox() {
  var props = PropertiesService.getScriptProperties();
  var disallowed = ['STATE_FILE_ID', 'SATORI_BOT_CLIENTS_JSON',
    'SATORI_BOT_SECRET', 'SANDBOX_PAYMENT_HTTP_FILE_ID'];
  for (var i=0;i<disallowed.length;i++) {
    if (props.getProperty(disallowed[i]))
      throw new Error('EXISTING_PROJECT_BLOCKED: create a BRAND NEW standalone sandbox project');
  }
  var folder = DriveApp.createFolder('SATORI_PAYMENT_HTTP_ONLY_' + Utilities.getUuid());
  var fixtures = [
    {id:'fixture-http-701', invoiceNo:70101, name:'FAKE KHÁCH HTTP A',
      total:125000, status:'Chưa thanh toán', date:'27/10/2026'},
    {id:'fixture-http-702', invoiceNo:70101, name:'FAKE KHÁCH HTTP B',
      total:250000, status:'Chưa thanh toán', date:'27/10/2026'}
  ];
  var state = {revision:1, updatedAt:'2026-10-27T00:00:00.000Z',
    values:{
      satori_orders_v15:JSON.stringify(fixtures),
      satori_trash_bin_v15:'[]',
      satori_deleted_invoice_nos:'[]',
      payment_http_sandbox_guard:SATORI_HTTP_FAKE_MARKER
    }};
  var content = JSON.stringify(state);
  var fake = folder.createFile(SATORI_HTTP_FAKE_NAME, content, MimeType.PLAIN_TEXT);
  var restore = fake.makeCopy('SATORI_PAYMENT_HTTP_INITIAL_BACKUP',folder);
  if (restore.getBlob().getDataAsString() !== content) throw Error('INITIAL_BACKUP_MISMATCH');
  var secret = Utilities.getUuid().replace(/-/g,'') +
    Utilities.getUuid().replace(/-/g,'');
  var clients = {'fixture-http':{enabled:true,secret:secret,
    scopes:['orders:read','payments:write']}};
  props.setProperties({
    STATE_FILE_ID:fake.getId(),
    SATORI_BOT_CLIENTS_JSON:JSON.stringify(clients),
    SANDBOX_PAYMENT_HTTP_FILE_ID:fake.getId(),
    SANDBOX_PAYMENT_HTTP_FOLDER_ID:folder.getId(),
    SANDBOX_PAYMENT_HTTP_RESTORE_ID:restore.getId(),
    SANDBOX_PAYMENT_HTTP_PROJECT_ID:ScriptApp.getScriptId()
  },false);
  // Intentionally do not display the HMAC secret.
  return {ok:true,sandboxOnly:true,
    fakeInvoiceCount:fixtures.length,initialRevision:1,
    initialBackupMatches:true,scriptId:ScriptApp.getScriptId()};
}

function paymentHttpFakeFile_() {
  var p = PropertiesService.getScriptProperties();
  var project = p.getProperty('SANDBOX_PAYMENT_HTTP_PROJECT_ID');
  var fileId = p.getProperty('SANDBOX_PAYMENT_HTTP_FILE_ID');
  var folderId = p.getProperty('SANDBOX_PAYMENT_HTTP_FOLDER_ID');
  if (!project || project !== ScriptApp.getScriptId() ||
      !fileId || !folderId || fileId !== p.getProperty('STATE_FILE_ID'))
    throw Error('SANDBOX_PROJECT_OR_FILE_GUARD');
  var file = DriveApp.getFileById(fileId);
  if (file.getName() !== SATORI_HTTP_FAKE_NAME || file.isTrashed())
    throw Error('SANDBOX_FILE_NAME_GUARD');
  var parents = file.getParents(), inFolder = false;
  while(parents.hasNext()) {
    if (parents.next().getId() === folderId) inFolder = true;
  }
  if (!inFolder) throw Error('SANDBOX_FOLDER_GUARD');
  var raw = file.getBlob().getDataAsString('UTF-8'), s = JSON.parse(raw);
  if (!s || !Number.isSafeInteger(s.revision) || s.revision < 1 ||
      !s.values || s.values.payment_http_sandbox_guard !== SATORI_HTTP_FAKE_MARKER)
    throw Error('SANDBOX_STATE_GUARD');
  var rows = JSON.parse(s.values.satori_orders_v15 || 'null');
  if (!Array.isArray(rows) || rows.length !== 2 ||
      rows.some(function(o){return !o ||
        !/^fixture-http-70[12]$/.test(String(o.id)) ||
        o.invoiceNo !== 70101 ||
        !/^FAKE KHÁCH HTTP [AB]$/.test(String(o.name)) ||
        ![125000,250000].includes(o.total);}))
    throw Error('SANDBOX_ROWS_GUARD');
  return {file:file,state:s,raw:raw};
}

// BotApi.gs calls this function. It always validates fake-only identity.
function readState_() {
  return paymentHttpFakeFile_().state;
}

function paymentHttpSandboxInfo() {
  var x = paymentHttpFakeFile_();
  return {ok:true,sandboxOnly:true,revision:x.state.revision,
    orders:JSON.parse(x.state.values.satori_orders_v15).length,
    hasConfiguredApiClient:true};
}

/**
 * Run AFTER publishing a separate sandbox-only Web App deployment.
 * This sends REAL HMAC-signed HTTP calls through doPost and writes ONLY
 * this project's synthetic fake Drive file.
 * Four independent changes are followed by byte-exact fake restoration.
 */
function runIsolatedPaymentHttpSmokeTest() {
  var info = paymentHttpFakeFile_();
  if (info.state.revision !== 1) throw Error('RESET_REQUIRED: fake fixture revision is not 1');
  var url = ScriptApp.getService().getUrl();
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\//.test(url))
    throw Error('NO_WEB_APP_DEPLOYMENT');
  var props = PropertiesService.getScriptProperties();
  var client = JSON.parse(props.getProperty('SATORI_BOT_CLIENTS_JSON'))['fixture-http'];
  var seed = info.raw, beforeRevision = info.state.revision;
  var checks=[], problem=null, backupCount=0, output={};

  function assert(ok,label){
    if(!ok) throw Error('FAIL: '+label);
    checks.push(label);
    console.log('PASS '+label);
  }
  function signed(action,payload) {
    var t=Date.now(),nonce=Utilities.getUuid().replace(/-/g,'')+
      Utilities.getUuid().replace(/-/g,'');
    var body={keyId:'fixture-http',timestamp:t,nonce:nonce,
      action:action,payload:payload||{}};
    var data=[body.keyId,t,nonce,action,JSON.stringify(body.payload)].join('\n');
    body.signature=Utilities.computeHmacSha256Signature(
      data,client.secret,Utilities.Charset.UTF_8)
      .map(function(x){return ('0'+(x&255).toString(16)).slice(-2);}).join('');
    var response = UrlFetchApp.fetch(url,{
      method:'post',contentType:'application/json',
      payload:JSON.stringify(body),followRedirects:true,
      muteHttpExceptions:true
    });
    var responseText = response.getContentText();
    var json;
    try{json=JSON.parse(responseText);}catch(e){
      throw Error('NON_JSON_SANDBOX_HTTP: status '+response.getResponseCode());
    }
    return json;
  }
  function payload(requestId){
    return {expectedRevision:readState_().revision,
      requestId:requestId,id:'fixture-http-701',invoiceNo:70101,
      expectedName:'FAKE KHÁCH HTTP A',expectedTotal:125000,
      confirmed:true,reason:'TEST ONLY — synthetic settlement, not real money'};
  }
  function verified(action,p,paidCustomer,paidSatori){
    var r=signed(action,p);
    assert(r.ok===true && r.backupCreated===true,action+' signed HTTP write');
    var list=signed('orders.list',{query:'70101'});
    assert(list.ok===true && list.revision===r.revision,
      action+' canonical HTTP readback');
    var rows=list.data&&list.data.orders||[];
    var a=rows.filter(function(o){return o.id==='fixture-http-701';})[0];
    var b=rows.filter(function(o){return o.id==='fixture-http-702';})[0];
    assert(!!a && a.customerPaid===paidCustomer && a.satoriPaid===paidSatori,
      action+' independent payment bits');
    assert(!!b && b.status==='Chưa thanh toán' && !b.customerPaid,
      'duplicate invoiceNo other ID untouched');
    backupCount++;
  }
  try{
    var status=signed('system.status',{});
    assert(status.ok===true && status.revision===1 && status.data.orders===2,
      'live HTTP read returns exactly two fake orders');
    verified('payments.markSatoriPaid',payload('fixture-satori-http-001'),false,true);
    verified('payments.markCustomerPaid',{
      expectedRevision:readState_().revision,
      id:'fixture-http-701',invoiceNo:70101,
      expectedName:'FAKE KHÁCH HTTP A',expectedTotal:125000,
      confirmed:true,amount:125000
    },true,true);
    verified('payments.markSatoriUnpaid',payload('fixture-satori-http-002'),true,false);
    verified('payments.markCustomerUnpaid',payload('fixture-customer-http-003'),false,false);
    var state=readState_();
    var rows=JSON.parse(state.values.satori_orders_v15);
    assert(state.revision===5 && rows[0].paymentAudit.length===3,
      'revision 5 and three independent audit corrections');
    var stale=signed('payments.markSatoriPaid',
      Object.assign({},payload('fixture-stale-http-001'),{expectedRevision:1}));
    assert(stale.ok===false&&stale.error.code==='REVISION_CONFLICT',
      'stale revision rejected');
    var wrong=signed('payments.markSatoriPaid',
      Object.assign({},payload('fixture-wrong-http-001'),{
        expectedName:'SOMEONE ELSE'}));
    assert(wrong.ok===false&&wrong.error.code==='ORDER_CHANGED',
      'wrong customer rejected');
  }catch(e){problem=String(e&&e.message||e);}
  // Do not change live or historical production. Restore only the fake file.
  try{
    var guarded=paymentHttpFakeFile_();
    output.lastFakeRevision=guarded.state.revision;
    if(guarded.raw!==seed) guarded.file.setContent(seed);
    output.restoredExactly=guarded.file.getBlob().getDataAsString('UTF-8')===seed;
  }catch(e){
    problem=(problem?problem+'; ':'')+'RESTORE: '+String(e);
    output.restoredExactly=false;
  }
  output.ok=!problem&&output.restoredExactly;
  output.passed=checks.length;
  output.failed=problem?1:0;
  output.error=problem;
  output.sandboxOnly=true;output.productionAccess=false;
  output.initialRevision=beforeRevision;
  output.successfulHttpWrites=backupCount;
  output.finishedAt=new Date().toISOString();
  var folder=DriveApp.getFolderById(props.getProperty('SANDBOX_PAYMENT_HTTP_FOLDER_ID'));
  folder.createFile('SATORI_PAYMENT_HTTP_E2E_REPORT.json',
    JSON.stringify(output,null,2),MimeType.PLAIN_TEXT);
  console.log('PAYMENT_HTTP_SANDBOX_RESULT '+JSON.stringify(output));
  if(!output.ok) throw Error('PAYMENT_HTTP_SANDBOX_FAILED: '+problem);
  return output;
}
