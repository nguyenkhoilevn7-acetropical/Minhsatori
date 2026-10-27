// Local synthetic smoke test of the standalone Apps Script HTTP sandbox environment.
// No external connections, credentials, Google Drive or actual Web App are accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac, randomUUID} from 'node:crypto';

const root=new URL('../',import.meta.url);
const apiSource=readFileSync(new URL('api/BotApi.gs',root),'utf8');
const sandboxSource=readFileSync(new URL('api/sandbox/PaymentHttpSandboxEnv.gs',root),'utf8');

function fixture(existing=false){
  const props=existing?{STATE_FILE_ID:'existing-real-project-marker'}:{};
  const files=new Map(),folders=new Map(),cache=new Map(),outputs=[];
  let seq=0, bot;
  const file=(name,initial,parent)=>{
    const id='fixture-file-'+(++seq);let content=initial;
    const f={
      getId:()=>id,getName:()=>name,isTrashed:()=>false,
      getParents:()=>{let called=false;return {
        hasNext:()=>!called,next:()=>{called=true;return parent;}
      };},
      getBlob:()=>({getDataAsString:()=>content}),
      setContent:v=>{content=v;},
      makeCopy:(n,p)=> (p||parent).createFile(n,content)
    };
    files.set(id,f);return f;
  };
  const DriveApp={
    createFolder:n=>{
      const id='fixture-folder-'+(++seq);
      const f={getId:()=>id,createFile:(name,raw)=>file(name,raw,f)};
      folders.set(id,f);return f;
    },
    getFileById:id=>{assert(files.has(id),'never access an unknown Drive file');return files.get(id);},
    getFolderById:id=>folders.get(id)
  };
  const PropertiesService={getScriptProperties:()=>({
    getProperty:k=>props[k]??null,
    setProperties:o=>Object.assign(props,o)
  })};
  const ScriptApp={getScriptId:()=> 'isolated-fixture-script-id',
    getService:()=>({getUrl:()=> 'https://script.google.com/macros/s/FAKE_ONLY/exec'})};
  const Utilities={getUuid:randomUUID,Charset:{UTF_8:'utf8'},
    computeHmacSha256Signature:(input,key,charset)=>{
      assert.equal(charset,'utf8');
      return [...createHmac('sha256',key).update(input,'utf8').digest()]
        .map(x=>x>127?x-256:x);
    }
  };
  const ContentService={MimeType:{JSON:'json'},createTextOutput:s=>({
    setMimeType(){return this;},getContent(){return s;}
  })};
  const LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
  const CacheService={getScriptCache:()=>({
    get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)
  })};
  const UrlFetchApp={fetch:(url,options)=>{
    assert.equal(url,ScriptApp.getService().getUrl());
    const result=bot.botPost({postData:{contents:options.payload}});
    return {getContentText:()=>result.getContent(),getResponseCode:()=>200};
  }};
  const app=new Function('DriveApp','PropertiesService','ScriptApp','Utilities',
    'ContentService','LockService','CacheService','UrlFetchApp','MimeType','console',
    apiSource+'\n'+sandboxSource+
    '\nreturn {setup:setupIsolatedPaymentHttpSandbox,'+
    'botPost:doPost,run:runIsolatedPaymentHttpSmokeTest,'+
    'read:readState_,info:paymentHttpSandboxInfo};');
  bot=app(DriveApp,PropertiesService,ScriptApp,Utilities,ContentService,
    LockService,CacheService,UrlFetchApp,{PLAIN_TEXT:'text/plain'},
    {log:s=>outputs.push(s)});
  return {bot,props,files,folders,outputs};
}
test('preexisting STATE_FILE_ID prohibits setup in production/existing project',()=>{
  const x=fixture(true);
  assert.throws(()=>x.bot.setup(),/EXISTING_PROJECT_BLOCKED/);
  assert.equal(x.folders.size,0);
});
test('isolated real BotApi handler and fake HTTP signed settlement 4-state matrix',()=>{
  const x=fixture(),setup=x.bot.setup();
  assert.equal(setup.ok,true);
  assert.equal(setup.sandboxOnly,true);
  assert.equal(x.bot.info().orders,2);
  const original=x.files.get(x.props.STATE_FILE_ID).getBlob().getDataAsString();
  const r=x.bot.run();
  assert.equal(r.ok,true);
  assert.equal(r.failed,0);
  assert.equal(r.passed,20);
  assert.equal(r.successfulHttpWrites,4);
  assert.equal(r.lastFakeRevision,5);
  assert.equal(r.restoredExactly,true);
  assert.equal(x.bot.info().revision,1);
  assert.equal(x.files.get(x.props.STATE_FILE_ID).getBlob().getDataAsString(),original);
  assert.equal([...x.files.values()].length,7);
  assert.equal(x.outputs.filter(l=>String(l).startsWith('PAYMENT_HTTP_SANDBOX_RESULT ')).length,1);
  assert(!x.outputs.some(l=>String(l).includes(x.props.SATORI_BOT_CLIENTS_JSON)));
  const resultFile=[...x.files.values()].find(f=>f.getName()==='SATORI_PAYMENT_HTTP_E2E_REPORT.json');
  assert.equal(JSON.parse(resultFile.getBlob().getDataAsString()).ok,true);
});
test('tampered property blocks all protected reads before contacting Drive',()=>{
  const x=fixture();x.bot.setup();
  x.props.STATE_FILE_ID='some-production-id';
  assert.throws(()=>x.bot.read(),/SANDBOX_PROJECT_OR_FILE_GUARD/);
});
test('HTTP bot rejects non-payment write scopes even in fake project',()=>{
  const x=fixture();x.bot.setup();
  const r=x.bot.botPost({postData:{contents:JSON.stringify({
    keyId:'fixture-http',timestamp:Date.now(),nonce:'syntheticfixture123456789',
    action:'orders.create',payload:{},signature:'f'.repeat(64)
  })}});
  assert.equal(JSON.parse(r.getContent()).error.code,'FORBIDDEN');
  assert.equal(x.bot.info().revision,1);
});
