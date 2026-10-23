import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const js=fs.readFileSync(path.join(root,'pdf-drive-archive.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

function boot(orders,completed={}){
  const map=new Map();
  map.set('satori_pdf_archive_completed_v1',JSON.stringify(completed));
  const handlers={},timers=new Map();let id=0;
  const parent={postMessage(){}};
  const window={
    __SATORI_DRIVE_APP__:true,__SATORI_DRIVE_READY__:true,parent,
    addEventListener(type,fn){handlers[type]=fn;}
  };
  const localStorage={
    getItem(key){return map.get(key)??null;},
    setItem(key,value){map.set(key,String(value));}
  };
  const sandbox={
    window,localStorage,orders,
    document:{hidden:false,addEventListener(){}},
    invoicePdfKey:o=>JSON.stringify([o.invoiceNo,o.name]),
    prepareInvoicePdf:async()=>{throw Error('Renderer deliberately disabled in this unit test');},
    setTimeout(fn){const key=++id;timers.set(key,fn);return key;},
    clearTimeout(key){timers.delete(key);},
    setInterval(){return 0;},
    console:{warn(){}}
  };
  vm.runInNewContext(js,sandbox,{filename:'pdf-drive-archive.js'});
  handlers.message({
    origin:'https://n-odiq6uswj4btzrnvxzkeunjxowbbmowt7yh4sqa-0lu-script.googleusercontent.com',
    source:parent,
    data:{channel:'minhsatori-pdf-archive-v1',type:'capabilities',enabled:true}
  });
  return {map,timers};
}

const all=[
  {id:'website',invoiceNo:5931,name:'Thạnh Phú'},
  {id:'bot',invoiceNo:5932,name:'Diamond',apiRequestId:'req-1'},
  {id:'zero',invoiceNo:5933,name:'TEST PDF - KHONG GIAO HANG',apiRequestId:'req-2',total:0}
];
{
  const run=boot(all);
  await [...run.timers.values()].at(-1)();
  const q=JSON.parse(run.map.get('satori_pdf_archive_pending_v1'));
  assert.deepEqual(q.map(x=>x.invoiceNo),[5933,5932]);
}
{
  const key=JSON.stringify([5932,'Diamond'])+'\\nSATORI_PDF_VIETQR_20261021';
  const run=boot(all,{'bot|5932':key});
  await [...run.timers.values()].at(-1)();
  const q=JSON.parse(run.map.get('satori_pdf_archive_pending_v1'));
  assert.deepEqual(q.map(x=>x.invoiceNo),[5933]);
}
assert.match(index,/if\\(total>0\\)bank\\.push\\(\\{qr:invoiceVietQrPayload\\(o\\)/);
assert.match(index,/if\\(payment\\.total<=0\\) return /);
console.log('PASS PDF archive: Bot API recovery, version dedupe and 0đ invoice PDF without payment QR');
