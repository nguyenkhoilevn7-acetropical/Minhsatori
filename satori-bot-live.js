/* Minh Satori Bot v1 — uses the EXISTING authenticated Drive-sync website.
   No third-party requests, no API keys, and no separate database. */
(function (root) {
  'use strict';
  var KEY='satori_orders_v15', PFX='satori-bot-', modal=null, current=null, guard=false;
  var esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ').trim();}
  function money(s){
    var str=String(s||'').replace(/[\sđ₫vnd]/gi,'');
    if(!/^\d[\d.,]*$/.test(str))return null;
    if(/^\d{1,3}(?:[.,]\d{3})+$/.test(str))return Number(str.replace(/[.,]/g,''));
    if(/^\d+[.,]\d{1,2}$/.test(str))return Number(str.replace(',','.'));
    return Number(str.replace(/[.,]/g,''));
  }
  function fmt(n){return Number(n||0).toLocaleString('vi-VN')+'đ';}
  function dateIso(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function parseMessage(text,now) {
    var raw=String(text||'').trim(),s=norm(raw),today=now instanceof Date?new Date(now.getTime()):new Date();
    var name='',m=raw.match(/(?:^|\n)\s*(?:tên\s*(?:khách)?|khách\s*(?:hàng)?|người\s*nhận)\s*[:：\-]\s*([^\n,;]+)/i);
    if(m)name=m[1].trim();
    if(!name){m=raw.match(/(?:^|\n|\s)(?:lên\s*đơn|tạo\s*đơn|đặt\s*hàng|giao(?:\s*hàng)?)\s+(?:(?:cho\s+)?(?:em|e)\s+|cho\s+)?([^\n,;]+)/i);if(m)name=m[1].replace(/\s+\d+\s*(?:t|thùng|binh|bình)\b.*$/i,'').trim();}
    var phone=(raw.match(/(?:\+84|0)[\s.-]?(?:\d[\s.-]?){8,10}/)||[])[0]||'';
    var address=(raw.match(/(?:địa\s*chỉ|giao\s*(?:tại|đến))\s*[:：-]?\s*([^\n;]+)/i)||[])[1]||'';
    var mention=raw.match(/(?:tổng\s*(?:tiền|cộng|thanh\s*toán)?|thành\s*tiền|tổng\s*đơn)\s*[:：=]?\s*(\d[\d.,]*)/i);
    var mentionedTotal=mention?money(mention[1]):null;
    var payment=/chưa\s*(?:thanh\s*toán|tt|trả)/i.test(raw)?'Chưa thanh toán':/đã\s*(?:thanh\s*toán|tt|trả)/i.test(raw)?'Đã thanh toán':'Chưa thanh toán';
    var day=/\bmai\b/i.test(s)?1:/\bmốt\b|\bmot\b/i.test(s)?2:0;
    today.setDate(today.getDate()+day);
    var explicitDate=raw.match(/(?:ngày\s*giao|giao\s*ngày)\s*[:：]?\s*(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}))?/i);
    var deliveryDate=dateIso(today);
    if(explicitDate) {
      var year=explicitDate[3]?Number(explicitDate[3]):today.getFullYear(),month=Number(explicitDate[2]),d=Number(explicitDate[1]);
      var candidate=new Date(year,month-1,d);
      if(candidate.getFullYear()===year&&candidate.getMonth()===month-1&&candidate.getDate()===d)deliveryDate=dateIso(candidate);
    }
    var items=[],part=raw.split(/[\n,;]+/);
    for(var k=0;k<part.length;k++){
      m=part[k].match(/(?:^|\s)(\d{1,5})\s*(thùng|thung|t(?=\s)|bình|binh|lốc|loc|chai|lon|két|ket)\s+(.+)/i);
      if(!m)continue;
      var product=m[3].trim().replace(/[.!?]+$/,''),price=null;
      var pp=product.match(/\s+(?:đơn\s*giá|giá)\s*[:：=]?\s*(\d[\d.,]*)/i);
      if(pp){price=money(pp[1]);product=product.slice(0,pp.index).trim();}
      product=product.replace(/\s*(?:tổng\s*(?:tiền|cộng)|chưa\s*thanh\s*toán|đã\s*thanh\s*toán)\b.*$/i,'').trim();
      if(product.length>1)items.push({qty:Number(m[1]),unit:/^(t|thung)$/i.test(m[2])?'Thùng':/^(binh)$/i.test(m[2])?'Bình':m[2],hint:product,price:price});
    }
    return {name:name,phone:phone,address:address,deliveryDate:deliveryDate,items:items,payment:payment,mentionedTotal:mentionedTotal,raw:raw};
  }
  function orderDate(o){
    var m=String(o.date||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    var dt=m?new Date(Number(m[3]),Number(m[2])-1,Number(m[1])).getTime():0;
    return Math.max(Number(o.timestamp)||0,dt||0);
  }
  function customerMatch(rows,query){
    var q=norm(query).replace(/[^a-z0-9 ]/g,'').trim();
    if(q.length<2)return [];
    return rows.map(o=>{
      var name=norm(o.name),score=name===q?100:name.includes('('+q+')')?95:name.endsWith(' '+q)?90:name.includes(q)?70:0;
      return {order:o,score:score};
    }).filter(x=>x.score).sort((a,b)=>b.score-a.score||orderDate(b.order)-orderDate(a.order));
  }
  function chooseProduct(parsed,matched,catalog){
    var first=parsed.items[0],hint=norm(first.hint),list=matched.map(x=>x.order);
    var last=null,explicitHint=/\d{2,4}\s*(?:ml|l)\b|premium|hikari|juice|ổi|me|mãng cầu/i.test(hint);
    if(explicitHint){
      var size=hint.match(/(\d{2,4})\s*(ml|l)\b/),wantsPremium=hint.includes('premium');
      var same=list.find(o=>Array.isArray(o.items)&&o.items.length===1&&norm(o.items[0].product).includes(size?size[1]:'')&&(!wantsPremium||norm(o.items[0].product).includes('premium')));
      if(same)last=same;
    } else {
      last=list.find(o=>Array.isArray(o.items)&&o.items.length===1);
    }
    if(!last)return null;
    var item=last.items[0],record=catalog.find(c=>c.code===item.code);
    if(!record)return null; // Do not infer unknown/custom product silently.
    var sizeHint=hint.match(/(\d{2,4})\s*(?:ml|l)\b/);
    if(sizeHint&&!norm(item.product).includes(sizeHint[1]))return null;
    if(/premium/i.test(hint)&&!norm(item.product).includes('premium'))return null;
    return {reference:last,product:item.product,code:item.code,unit:item.unit||record.unit||'Thùng',
      listPrice:Number(item.listPrice),unitPrice:Number(item.unitPrice),
      discountPercent:Number(item.discountPercent),source:'Giá từ hóa đơn #'+last.invoiceNo};
  }
  function buildDraft(message,rows,catalog,now) {
    var p=parseMessage(message,now),candidates=customerMatch(rows,p.name);
    var ref=candidates.length?candidates[0].order:null;
    var inferred=chooseProduct(p,candidates,catalog),first=p.items[0]||null;
    var warnings=[];
    if(!p.name)warnings.push('Chưa nhận diện tên khách hàng.');
    if(!ref)warnings.push('Chưa tìm thấy khách trong lịch sử; không thể tự điền địa chỉ và giá.');
    if(p.items.length!==1)warnings.push('Phiên bản này chỉ tự lưu tin có đúng một mặt hàng.');
    if(!inferred)warnings.push('Chưa xác định loại nước và giá từ đơn cũ. Vui lòng nhập bằng form thông thường.');
    if(p.items.length>1)warnings.push('Đơn có nhiều loại nước: hãy kiểm tra từng loại trước khi lưu.');
    var qty=first?first.qty:0,price=first&&first.price!==null?first.price:inferred?inferred.unitPrice:null;
    if(first&&first.price!==null&&inferred&&first.price!==inferred.unitPrice)warnings.push('Đơn giá trong tin khác đơn cũ; cần kiểm tra kỹ.');
    var goods=Number.isSafeInteger(qty)&&qty>0&&Number.isFinite(price)?qty*price:0;
    var vat=ref&&ref.vat==='yes'?'yes':'no';
    var shippingPercent=ref?Number(ref.shippingPercent||0):0;
    // Do not implicitly copy nonzero shipping to new invoices.
    if(shippingPercent)warnings.push('Đơn cũ có phí giao hàng. Bot mặc định phí giao 0%, anh cần kiểm tra.');
    var vatValue=vat==='yes'?Math.round(goods*.08):0;
    var total=goods+vatValue;
    if(p.mentionedTotal!==null&&total!==p.mentionedTotal)warnings.push('Tổng tiền nhắn ('+fmt(p.mentionedTotal)+') khác số Bot tính ('+fmt(total)+').');
    return {raw:p.raw,query:p.name,customer:ref?ref.name:p.name,
      phone:p.phone||ref?.phone||'',address:p.address||ref?.location||'',taxCode:ref?.taxCode||'',
      deliveryDate:p.deliveryDate,qty:qty,unit:inferred?.unit||first?.unit||'Thùng',hint:first?.hint||'',
      product:inferred?.product||'',code:inferred?.code||'',listPrice:inferred?.listPrice||0,
      price:price,vat:vat,shippingPercent:0,payment:p.payment,total:total,mentionedTotal:p.mentionedTotal,
      referenceNo:inferred?.reference.invoiceNo||null,source:inferred?.source||'',costDiscountPercent:ref?.costDiscountPercent,
      warnings:warnings,matched:!!ref,ready:!!(ref&&inferred&&first&&first.qty>0&&p.items.length===1&&Number.isFinite(price)&&price>0&&!warnings.some(w=>w.includes('Tổng tiền nhắn')))};
  }
  // The website's existing Drive iframe is the only write channel.
  function cloudSynced() {
    if (!root.__SATORI_DRIVE_APP__) return false;
    var dot=document.getElementById('driveSyncDot'),cover=document.getElementById('driveLoadingCover');
    if(!dot||!String(dot.title||dot.getAttribute('aria-label')||'').includes('Đã đồng bộ Google Drive'))return false;
    if(cover&&cover.style.display!=='none')return false;
    return true;
  }
  function getRows(){
    if(!root.__SATORI_DRIVE_APP__)return [];
    try{var a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[]}catch(e){return []}
  }
  function input(id){return document.getElementById(PFX+id)}
  function hide(){if(modal)modal.hidden=true;document.body.style.overflow=''}
  function open(){
    if(!modal)return;
    modal.hidden=false;document.body.style.overflow='hidden';
    input('message').focus();
    renderStatus('Dán tin nhắn rồi bấm “Phân tích”.',false);
  }
  function renderStatus(msg,bad){var e=input('status-msg');if(!e)return;e.textContent=msg;e.style.color=bad?'#fecaca':'#a6e9dd';}
  function preview(draft){
    current=draft;
    var p=input('preview');p.hidden=false;
    var set=(id,s)=>{input(id).textContent=String(s==null||s===''?'—':s)};
    set('name',draft.customer);set('phone',draft.phone);set('address',draft.address);
    set('product',draft.product||'Chưa rõ');set('source',draft.source||'Chưa xác định');
    input('qty').value=draft.qty||'';input('unitprice').value=draft.price==null?'':draft.price;
    input('vat').value=draft.vat;input('delivery').value=draft.deliveryDate;
    set('reference',draft.referenceNo?'Hóa đơn #'+draft.referenceNo:'Chưa có');
    var alerts=input('warnings');alerts.replaceChildren();
    draft.warnings.forEach(t=>{var p=document.createElement('p');p.textContent='⚠ '+t;alerts.appendChild(p)});
    calculatePreview();
  }
  function calculatePreview(){
    if(!current)return;
    var qty=Number(input('qty').value),price=Number(input('unitprice').value);
    var total=Number.isSafeInteger(qty)&&qty>0&&Number.isFinite(price)&&price>0?Math.round(qty*price*(input('vat').value==='yes'?1.08:1)):null;
    var sum=input('total');sum.textContent=total===null?'Thiếu số lượng / giá':fmt(total);
    var mismatch=current.mentionedTotal!==null&&total!==null&&current.mentionedTotal!==total;
    var msg=input('mismatch');msg.textContent=mismatch?'Tin nhắn ghi '+fmt(current.mentionedTotal)+' — không khớp tổng Bot tính.':'';
    input('save').disabled=guard||!current.ready||total===null||mismatch||!cloudSynced()||!input('delivery').value;
    input('apply').disabled=!current.ready||total===null;
  }
  function applyToForm(draft,saveNow){
    if(!draft||!draft.ready)throw Error('Đơn chưa đủ thông tin an toàn để tạo.');
    if(typeof currentEditingOrderId==='undefined'||currentEditingOrderId!==null)throw Error('Đang sửa hóa đơn cũ; hãy hoàn tất hoặc thoát chế độ sửa trước.');
    if(!cloudSynced())throw Error('Google Drive chưa báo đồng bộ thành công. Không ghi dữ liệu vào bản trên máy.');
    if(typeof handleSaveAndGenerate!=='function'||typeof renderItemsForm!=='function'||typeof calculateTotals!=='function')throw Error('Không tìm thấy chức năng lưu hóa đơn hiện tại.');
    var qty=Number(input('qty').value),price=Number(input('unitprice').value);
    var delivery=input('delivery').value,vat=input('vat').value;
    if(!Number.isSafeInteger(qty)||qty<=0||qty>10000||!Number.isFinite(price)||price<=0||price>1e9)throw Error('Số lượng hoặc giá không hợp lệ.');
    if(!/^\d{4}-\d\d-\d\d$/.test(delivery))throw Error('Ngày giao không hợp lệ.');
    var days=new Date(delivery+'T00:00:00');if(Number.isNaN(days.getTime())||dateIso(days)!==delivery)throw Error('Ngày giao không hợp lệ.');
    var total=Math.round(qty*price*(vat==='yes'?1.08:1));
    if(draft.mentionedTotal!==null&&total!==draft.mentionedTotal)throw Error('Tổng tiền không khớp tin nhắn.');
    var values=Object.fromEntries(['busName','busPhone','busLocation','taxCode','orderDate','invoiceNo','vatOption','shippingOption','paymentStatus','costDiscountPercent'].map(k=>[k,document.getElementById(k)?.value]));
    var rows=getRows(),reference=rows.find(o=>Number(o.invoiceNo)===Number(draft.referenceNo));
    if(!reference||reference.name!==draft.customer)throw Error('Khách hàng đã thay đổi trên Drive. Phân tích lại tin nhắn.');
    var productRow=reference.items?.find(x=>x.code===draft.code);
    if(!productRow)throw Error('Sản phẩm đã đổi. Vui lòng phân tích lại.');
    var nextNo=1+rows.reduce((n,o)=>Math.max(n,Number(o.invoiceNo)||0),0);
    if(!Number.isSafeInteger(nextNo)||rows.some(o=>Number(o.invoiceNo)===nextNo))throw Error('Không xác định được số hóa đơn mới.');
    var fresh=localStorage.getItem(KEY);if(!fresh)throw Error('Không có dữ liệu đã đồng bộ.');
    document.getElementById('busName').value=draft.customer;
    document.getElementById('busPhone').value=draft.phone;
    document.getElementById('busLocation').value=draft.address;
    document.getElementById('taxCode').value=draft.taxCode;
    document.getElementById('orderDate').value=dateIso(new Date());
    document.getElementById('invoiceNo').value=nextNo;
    document.getElementById('vatOption').value=vat;
    document.getElementById('shippingOption').value='0';
    document.getElementById('paymentStatus').value='Chưa thanh toán';
    var c=document.getElementById('costDiscountPercent');if(c&&Number.isFinite(Number(draft.costDiscountPercent)))c.value=draft.costDiscountPercent;
    var collab=document.getElementById('acct-form-partner');if(collab)collab.value='';
    isManualProfitOverride=false;
    currentItems=[{id:Date.now(),code:draft.code,product:draft.product,unit:draft.unit,
      qty:qty,listPrice:draft.listPrice,discountPercent:draft.listPrice?(draft.listPrice-price)/draft.listPrice*100:0,
      discountAmount:draft.listPrice-price,unitPrice:price,subtotal:qty*price}];
    nextInvoiceNumber=nextNo;
    renderItemsForm();calculateTotals();switchTab('input');
    if(!saveNow){hide();document.getElementById('orderForm')?.scrollIntoView({behavior:'smooth',block:'start'});return {invoiceNo:nextNo,saved:false}}
    // LocalStorage mutation is done ONLY by the existing site's save function, not by this bot.
    var reqId='bot-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    if(getRows().some(o=>o.botRequestId===reqId))throw Error('Yêu cầu đã được ghi.');
    var lastRaw=localStorage.getItem(KEY);
    root.__satoriBotSaveMeta={requestId:reqId,deliveryDate:delivery,sourceMessage:draft.raw};
    try{handleSaveAndGenerate()}finally{delete root.__satoriBotSaveMeta}
    var saved=getRows().find(o=>o.botRequestId===reqId);
    if(!saved){ // Existing form save may have rejected. Keep form populated for manual inspection.
      throw Error('Chưa xác minh được hóa đơn mới trong sổ kế toán trên máy. Không nhấn lưu lại trước khi kiểm tra.');
    }
    hide();
    watchDrive(saved,reqId);
    return {invoiceNo:saved.invoiceNo,saved:true};
  }
  function toast(msg,bad){
    var old=document.getElementById('satori-bot-toast');if(old)old.remove();
    var e=document.createElement('div');e.id='satori-bot-toast';e.setAttribute('role','status');
    e.style.cssText='position:fixed;top:12px;left:12px;right:12px;margin:auto;max-width:560px;z-index:100009;padding:15px;border-radius:14px;color:white;font:600 14px/1.5 system-ui;background:'+(bad?'#82262d':'#11695c')+';box-shadow:0 9px 24px #0007';
    e.textContent=msg;document.body.appendChild(e);setTimeout(()=>e.remove(),bad?20000:9000);
  }
  function watchDrive(saved,reqId){
    toast('Bot đã tạo bản ghi hóa đơn #'+saved.invoiceNo+' trên máy. Đang chờ Google Drive xác nhận…',false);
    var start=Date.now(),seenPending=!cloudSynced();
    var loop=setInterval(function(){
      if(!cloudSynced())seenPending=true;
      var exists=getRows().some(o=>o.botRequestId===reqId&&o.invoiceNo===saved.invoiceNo);
      if(seenPending&&cloudSynced()&&exists){clearInterval(loop);toast('✓ Hóa đơn #'+saved.invoiceNo+' đã được hệ thống báo đồng bộ Google Drive.',false)}
      else if(Date.now()-start>60000){clearInterval(loop);toast('Chưa xác minh được Drive đã lưu hóa đơn #'+saved.invoiceNo+'. Không tạo lại đơn. Hãy kiểm tra thanh trạng thái đồng bộ và kho hóa đơn.',true)}
    },1000);
  }
  function mount(){
    if(!root.__SATORI_DRIVE_APP__)return; // Public GitHub Pages must never expose this privileged UI.
    if(document.getElementById('satori-bot-launch'))return;
    var css=document.createElement('style');css.textContent=
    '#satori-bot-launch{position:fixed;right:14px;bottom:70px;z-index:99950;border:1px solid #7df7dc;background:#07675d;color:white;border-radius:20px;padding:12px 17px;box-shadow:0 9px 24px #0008;font:bold 14px system-ui;cursor:pointer}'+
    '#satori-bot-dialog[hidden],#satori-bot-preview[hidden]{display:none!important}#satori-bot-dialog{position:fixed;inset:0;z-index:100007;background:#020d17e8;overflow:auto;padding:12px;display:flex;justify-content:center;align-items:flex-start}'+
    '#satori-bot-dialog .sb-card{width:min(100%,680px);margin:5vh auto 10px;background:#101e2f;color:#ecf8ff;border:1px solid #426779;border-radius:18px;padding:22px;font:14px/1.5 system-ui;box-shadow:0 16px 50px #0008}'+
    '#satori-bot-dialog h2{font-size:21px;margin:0}#satori-bot-dialog label{display:block;font-weight:700;color:#c6d9e7;margin:8px 0 5px}'+
    '#satori-bot-dialog textarea,#satori-bot-dialog input,#satori-bot-dialog select{width:100%;background:#081421;color:#fff;border:1px solid #557487;border-radius:9px;padding:10px;font:inherit}'+
    '#satori-bot-dialog button{background:#12695f;border:1px solid #5ad3c3;color:#fff;font-weight:700;padding:11px;border-radius:10px;cursor:pointer}#satori-bot-dialog button:disabled{opacity:.45;cursor:not-allowed}'+
    '#satori-bot-dialog .sb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}#satori-bot-dialog .sb-line{border-top:1px solid #3a5266;padding-top:10px;margin-top:10px}'+
    '#satori-bot-dialog .sb-note{color:#fbd38d;font-size:12px}#satori-bot-dialog .sb-warning{color:#fcd58a;font-size:12px}'+
    '@media(max-width:540px){#satori-bot-dialog .sb-grid{grid-template-columns:1fr}#satori-bot-dialog .sb-card{padding:14px;margin:0}}';
    document.head.appendChild(css);
    var launcher=document.createElement('button');launcher.id='satori-bot-launch';launcher.type='button';launcher.textContent='🤖 Bot lên đơn';launcher.onclick=open;document.body.appendChild(launcher);
    modal=document.createElement('section');modal.id='satori-bot-dialog';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Trợ lý lên đơn Minh Satori');modal.hidden=true;
    modal.innerHTML='<div class="sb-card"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><h2>🤖 Bot Minh Satori</h2><button type="button" id="satori-bot-close" aria-label="Đóng">✕</button></div>'+
    '<p style="color:#a5bdd0">Dán tin nhắn Zalo; Bot tra lịch sử khách và tự điền đơn. Không tự gửi đơn khi chưa bấm xác nhận.</p>'+
    '<label for="satori-bot-message">Tin nhắn khách hàng</label><textarea id="satori-bot-message" rows="4" placeholder="Mai giao e Ốc Q&#10;10T suoi"></textarea>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button type="button" id="satori-bot-analyze">Phân tích</button><button type="button" id="satori-bot-sample">Tin nhắn mẫu</button></div>'+
    '<div id="satori-bot-preview" hidden><div class="sb-line"><b>Khách:</b> <span id="satori-bot-name"></span><p style="margin:5px 0">☎ <span id="satori-bot-phone"></span></p><p style="margin:5px 0">📍 <span id="satori-bot-address"></span></p></div>'+
    '<div class="sb-line"><b>Sản phẩm:</b> <span id="satori-bot-product"></span><p class="sb-note">Giá tham chiếu: <span id="satori-bot-source"></span> · <span id="satori-bot-reference"></span></p></div>'+
    '<div class="sb-grid"><div><label for="satori-bot-qty">Số lượng</label><input id="satori-bot-qty" type="number" min="1" max="10000"></div><div><label for="satori-bot-unitprice">Đơn giá (đ)</label><input id="satori-bot-unitprice" type="number" min="1"></div>'+
    '<div><label for="satori-bot-vat">Thuế VAT</label><select id="satori-bot-vat"><option value="no">Không VAT</option><option value="yes">VAT 8%</option></select></div><div><label for="satori-bot-delivery">Ngày giao</label><input id="satori-bot-delivery" type="date"></div></div>'+
    '<div class="sb-line"><b>Tổng thanh toán: <span id="satori-bot-total"></span></b><p class="sb-warning" id="satori-bot-mismatch"></p><div class="sb-warning" id="satori-bot-warnings"></div></div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:9px;margin-top:14px"><button type="button" id="satori-bot-apply">Điền vào form (chưa lưu)</button><button type="button" id="satori-bot-save">XÁC NHẬN LƯU ĐƠN THẬT</button></div>'+
    '<p class="sb-note">Chỉ lưu trong bản Minh Satori đăng nhập Google Drive; sau khi ghi, cần chờ Drive xác nhận. Nếu chưa đồng bộ, nút lưu bị khóa.</p></div>'+
    '<p id="satori-bot-status-msg" role="status" style="min-height:24px;color:#a6e9dd"></p></div>';
    document.body.appendChild(modal);
    input('close').onclick=hide;
    input('sample').onclick=()=>{input('message').value='Mai giao e Ốc Q\n10T suoi';input('message').focus()};
    input('analyze').onclick=function(){
      var msg=input('message').value.trim();
      if(!msg){renderStatus('Cần dán tin nhắn trước.',true);return}
      try{var d=buildDraft(msg,getRows(),Array.isArray(catalogue)?catalogue:[],new Date());preview(d);renderStatus(d.ready?'Đã tìm thông tin cũ. Kiểm tra rồi bấm lưu.':'Đơn còn thiếu thông tin; chưa thể lưu tự động.',!d.ready)}
      catch(e){renderStatus('Không phân tích được tin nhắn: '+e.message,true)}
    };
    ['qty','unitprice','vat','delivery'].forEach(k=>input(k).addEventListener('input',calculatePreview));
    input('apply').onclick=function(){
      try{applyToForm(current,false);toast('Bot đã điền vào form. Chưa lưu hóa đơn mới.',false)}catch(e){renderStatus(e.message,true)}
    };
    input('save').onclick=function(){
      if(guard)return;
      if(!current||!current.ready){renderStatus('Hóa đơn chưa đủ thông tin.',true);return}
      if(!cloudSynced()){renderStatus('Chưa đồng bộ xong Google Drive, hãy thử lại.',true);calculatePreview();return}
      var qty=Number(input('qty').value),price=Number(input('unitprice').value),vat=input('vat').value,date=input('delivery').value;
      var summary='LƯU ĐƠN THẬT?\nKhách: '+current.customer+'\nSản phẩm: '+current.product+
      '\nSố lượng: '+qty+' '+current.unit+'\nĐơn giá: '+fmt(price)+
      '\nVAT: '+(vat==='yes'?'8%':'0%')+'\nNgày giao: '+date+
      '\nTổng: '+fmt(Math.round(qty*price*(vat==='yes'?1.08:1)))+'\nTrạng thái: Chưa thanh toán';
      if(!confirm(summary))return;
      guard=true;calculatePreview();
      try{var done=applyToForm(current,true);renderStatus('Đã tạo đơn #'+done.invoiceNo+'; đang chờ xác nhận Drive.',false)}
      catch(e){renderStatus('Chưa hoàn tất lưu: '+e.message,true)}
      finally{guard=false;calculatePreview()}
    };
    setInterval(function(){if(current&&!modal.hidden)calculatePreview()},2000);
  }
  root.SatoriBotParser={parseMessage:parseMessage,customerMatch:customerMatch,buildDraft:buildDraft};
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
    else mount();
  }
})(typeof window!=='undefined'?window:globalThis);
