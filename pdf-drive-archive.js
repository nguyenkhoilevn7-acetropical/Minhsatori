/* Archive the ORIGINAL pdfmake invoice Blob after Drive confirms the order save.
 * This module never generates a second invoice template and never changes order data.
 * The authenticated Apps Script iframe parent must opt in to this channel.
 */
(function(){
  'use strict';
  if(!window.__SATORI_DRIVE_APP__ || window.parent===window)return;
  var origin='https://n-odiq6uswj4btzrnvxzkeunjxowbbmowt7yh4sqa-0lu-script.googleusercontent.com';
  var channel='minhsatori-pdf-archive-v1';
  var storageKey='satori_pdf_archive_pending_v1';
  var templateVersion='SATORI_PDF_VIETQR_20261021';
  var enabled=false,busy=false,seq=0,timer=null,inFlight=null;
  function readQueue(){try{var v=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(v)?v:[];}catch(_){return [];}}
  function saveQueue(q){localStorage.setItem(storageKey,JSON.stringify(q));}
  function queueOrder(o){
    if(!o || !Number.isSafeInteger(Number(o.invoiceNo)) || o.id==null)return;
    var q=readQueue(),id=String(o.id),no=Number(o.invoiceNo);
    if(!q.some(function(x){return String(x.id)===id && Number(x.invoiceNo)===no;})){
      q.push({id:id,invoiceNo:no});
      saveQueue(q);
    }
    schedule(100);
  }
  function schedule(ms){clearTimeout(timer);timer=setTimeout(run,ms||0);}
  function current(ref){
    if(typeof orders==='undefined'||!Array.isArray(orders))return null;
    var matches=orders.filter(function(o){return String(o.id)===String(ref.id)&&Number(o.invoiceNo)===Number(ref.invoiceNo);});
    return matches.length===1?JSON.parse(JSON.stringify(matches[0])):null;
  }
  function base64(blob){
    return new Promise(function(resolve,reject){
      var r=new FileReader();
      r.onerror=function(){reject(new Error('Không đọc được PDF để lưu Drive.'));};
      r.onload=function(){var s=String(r.result||'');resolve(s.slice(s.indexOf(',')+1));};
      r.readAsDataURL(blob);
    });
  }
  function hex(buffer){return Array.from(new Uint8Array(buffer),function(b){return b.toString(16).padStart(2,'0');}).join('');}
  async function run(){
    if(!enabled||busy||!window.__SATORI_DRIVE_READY__||document.hidden)return;
    var q=readQueue();if(!q.length)return;
    var ref=q[0],o=current(ref);
    if(!o){saveQueue(q.slice(1));return schedule(100);}
    busy=true;
    try{
      if(typeof prepareInvoicePdf!=='function'||typeof invoicePdfKey!=='function')throw Error('Thiếu bộ tạo PDF của website.');
      var key=invoicePdfKey(o)+'\n'+templateVersion;
      var result=await prepareInvoicePdf(o);
      var bytes=await result.blob.arrayBuffer();
      if(bytes.byteLength<100||bytes.byteLength>3*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Tệp PDF sai định dạng hoặc vượt 3 MB.');
      // The Drive sync may have changed this order while pdfmake was running.
      var now=current(ref);
      if(!now||invoicePdfKey(now)!==invoicePdfKey(o)){busy=false;return schedule(1000);}
      inFlight={ref:ref,versionKey:key};
      window.parent.postMessage({channel:channel,type:'put',id:++seq,payload:{
        invoiceNo:Number(o.invoiceNo),id:String(o.id),total:Number(o.total),
        versionKey:key,pdfSha256:hex(await crypto.subtle.digest('SHA-256',bytes)),
        pdfBase64:await base64(result.blob)
      }},origin);
      setTimeout(function(){
        if(busy && inFlight && String(inFlight.ref.id)===String(ref.id)){
          busy=false;inFlight=null;console.warn('Lưu PDF Drive chưa được xác nhận; giữ lại hàng chờ.');schedule(15000);
        }
      },40000);
    }catch(e){busy=false;inFlight=null;console.warn('Lưu PDF Drive sẽ thử lại:',e.message);schedule(15000);}
  }
  window.satoriArchiveSavedInvoicePdf=function(order){
    queueOrder(order);
    return Promise.resolve();
  };
  window.addEventListener('message',function(event){
    var m=event.data;
    if(event.origin!==origin||event.source!==window.parent||m?.channel!==channel)return;
    if(m.type==='capabilities'){enabled=m.enabled===true;schedule(100);return;}
    if(!inFlight||!busy)return;
    if(m.type==='stored'&&m.invoiceNo===inFlight.ref.invoiceNo&&m.versionKey===inFlight.versionKey&&m.fileId){
      var saved=inFlight.ref;
      saveQueue(readQueue().filter(function(x){return !(String(x.id)===String(saved.id)&&Number(x.invoiceNo)===Number(saved.invoiceNo));}));
      busy=false;inFlight=null;schedule(300);return;
    }
    if(m.type==='error'){
      console.warn('Drive từ chối lưu PDF:',String(m.error||'không xác định'));
      busy=false;inFlight=null;schedule(15000);
    }
  });
  window.parent.postMessage({channel:channel,type:'hello'},origin);
  window.addEventListener('online',function(){schedule(1000);});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)schedule(1000);});
  setInterval(function(){if(!enabled)window.parent.postMessage({channel:channel,type:'hello'},origin);else schedule(1000);},15000);
})();
