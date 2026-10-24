/* Authenticated production adapter for the ORIGINAL Gemini UI.
 * Keeps index.html's exact DOM, catalogue sheet, chat, cart and invoice panels.
 * Only source/API access differs. Uses strictly private authenticated real endpoints.
 */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const token=decodeURIComponent(location.hash.slice(1));
 let accessCode='',catalogue=null,selectedRef=null,agency=false,requestsBusy=false;
 let quoteToken=null,lastQuote=null,lastReceipt=null,deliveryNote='';
 let destinations=[],lastProduct=null;
 const products=new Map(),cart=new Map();
 const cash=n=>Math.round(Number(n)||0).toLocaleString('vi-VN')+' đ';
 const setText=(id,text)=>{const node=$(id);if(node)node.textContent=String(text||'')};
 const disabledBusy=value=>{requestsBusy=value;for(const id of ['realOpen','quickCartQuote','composeCart']){
  if($(id))$(id).disabled=value;
 }};
 const status=text=>setText('realGateStatus',text);
 async function call(endpoint,payload={}){
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
   credentials:'omit',cache:'no-store',
   body:JSON.stringify({token,accessCode,...payload})});
  let data;try{data=await r.json()}catch{throw Error('Phản hồi máy chủ không hợp lệ.')}
  if(!r.ok||!data.ok)throw Error(data.message||data.code||'Không kết nối được Production.');
  return data;
 }
 const bubble=(message,role='assistant')=>{
  const div=document.createElement('div');div.className='bubble '+role;
  div.textContent=String(message||'').slice(0,1500);
  $('messages').append(div);$('messages').scrollTop=$('messages').scrollHeight;
  return div;
 };
 function validCart(next=cart){
  const rows=[...next.values()];
  if(rows.length>6)throw Error('Chỉ được đặt tối đa 6 loại sản phẩm trong một đơn.');
  if(rows.some(x=>!Number.isSafeInteger(x.qty)||x.qty<1||x.qty>500)||
   rows.reduce((n,x)=>n+x.qty,0)>500)throw Error('Tổng số lượng tối đa 500 đơn vị.');
 }
 function invalidate(){
  quoteToken=null;lastQuote=null;
  for(const b of document.querySelectorAll('.live-real-confirm')){b.disabled=true;b.textContent='Báo giá cũ';}
 }
 function currentProducts(){
  return [...products.values()];
 }
 function updateCart(){
  const entries=[...cart.values()],count=entries.reduce((n,x)=>n+x.qty,0);
  setText('quickCartCount','🛒 Giỏ hàng chung • '+entries.length+' loại / '+count+' đơn vị');
  setText('cartCount',entries.length+'/6');
  setText('cartFeedback',entries.length?'Đã lưu trong giỏ chung; chưa tạo hóa đơn.':'Chọn món để bắt đầu.');
  $('quickCart').hidden=!entries.length;
  $('composeCart').disabled=!entries.length;
  $('quickCartQuote').disabled=!entries.length;
  const list=$('inlineCartLines'),sheet=$('cartList');list.replaceChildren();sheet.replaceChildren();
  if(!entries.length){const empty=document.createElement('span');empty.textContent='Giỏ chưa có món.';sheet.append(empty);}
  for(const item of entries){
   for(const host of [list,sheet]){
    const row=document.createElement('div');row.className=host===list?'inline-cart-row':'cart-line';
    const name=document.createElement('span');name.textContent=item.name+' • '+item.unit;
    const controls=document.createElement('span');controls.style.cssText='display:flex;align-items:center;gap:7px';
    const minus=document.createElement('button');minus.type='button';minus.textContent='−';minus.className='btn alt';minus.style.padding='6px 10px';
    minus.onclick=()=>changeQty(item.code,item.qty-1);
    const qty=document.createElement('input');qty.type='number';qty.min='0';qty.max='500';qty.step='1';qty.value=String(item.qty);
    qty.setAttribute('aria-label','Số lượng '+item.name);qty.style.cssText='width:65px;min-height:37px;padding:6px;text-align:center';
    qty.onchange=()=>{try{changeQty(item.code,Number(qty.value))}catch(e){bubble(e.message,'note');updateCart();}};
    const plus=document.createElement('button');plus.type='button';plus.textContent='＋';plus.className='btn alt';plus.style.padding='6px 10px';
    plus.onclick=()=>changeQty(item.code,item.qty+1);
    controls.append(minus,qty,plus);row.append(name,controls);host.append(row);
   }
  }
 }
 function changeQty(code,qty){
  if(!Number.isSafeInteger(qty)||qty<0||qty>500)throw Error('Số lượng không hợp lệ.');
  if(!products.has(code))throw Error('Mặt hàng không thuộc bảng giá được duyệt.');
  const next=new Map(cart);if(qty===0)next.delete(code);
  else {const p=products.get(code);next.set(code,{code,qty,name:p.name,unit:p.unit})}
  validCart(next);
  cart.clear();for(const [k,v] of next)cart.set(k,v);
  invalidate();updateCart();
 }
 function category(p){
  const name=String(p.name||'').toLowerCase();
  if(name.includes('hikari'))return 'HIKARI';
  if(name.includes('juice')||name.includes('ép'))return 'JUICE';
  return 'SATORI';
 }
 let catalogFilter='ALL';
 function renderCatalogue(){
  const root=$('catalogItems');root.replaceChildren();
  const search=($('catalogSearch').value||'').toLocaleLowerCase('vi');
  const arr=currentProducts().filter(p=>
   (catalogFilter==='ALL'||category(p)===catalogFilter)&&
   (!search||(p.name+' '+p.code).toLocaleLowerCase('vi').includes(search)));
  setText('catalogDescription',currentProducts().length+' sản phẩm từ hệ thống thật • giá sau CK');
  for(const p of arr){
   const button=document.createElement('button');button.type='button';button.className='catalog-item';
   const logo=document.createElement('span');logo.className='catalog-icon';logo.textContent=category(p)==='JUICE'?'🍹':'💧';
   const label=document.createElement('span');label.className='catalog-label';label.textContent=p.name;
   const secondary=document.createElement('small');secondary.textContent=cash(p.unitPrice)+' / '+p.unit;label.append(secondary);
   const arrow=document.createElement('span');arrow.className='catalog-arrow';arrow.textContent='＋';
   button.append(logo,label,arrow);
   button.onclick=()=>{lastProduct=p;setText('selectedProductName',p.name+' • '+cash(p.unitPrice)+' / '+p.unit);
    $('selectedQuantity').value='1';$('productSelection').classList.add('active');};
   root.append(button);
  }
  if(!arr.length){const p=document.createElement('p');p.className='catalog-empty';p.textContent='Không tìm thấy sản phẩm phù hợp.';root.append(p)}
 }
 function openCatalogue(){
  if(!catalogue){bubble('Vui lòng chọn địa chỉ giao đã duyệt trước khi xem bảng giá.','note');return}
  renderCatalogue();$('catalogBackdrop').classList.add('open');
 }
 function closeCatalogue(){$('catalogBackdrop').classList.remove('open')}
 $('catalogLaunch').onclick=openCatalogue;
 $('heroShopCta').onclick=openCatalogue;
 $('allProductsButton').onclick=openCatalogue;
 $('catalogClose').onclick=closeCatalogue;
 $('catalogSearch').oninput=renderCatalogue;
 for(const chip of document.querySelectorAll('[data-brand]')){
  chip.onclick=()=>{catalogFilter=chip.dataset.brand;for(const x of document.querySelectorAll('[data-brand]'))x.classList.toggle('active',x===chip);
   renderCatalogue()};
 }
 $('addProductMessage').onclick=()=>{
  try{
   if(!lastProduct)throw Error('Hãy chọn một sản phẩm.');
   const qty=Number($('selectedQuantity').value);
   if(!Number.isSafeInteger(qty)||qty<1||qty>500)throw Error('Số lượng từ 1 đến 500.');
   changeQty(lastProduct.code,(cart.get(lastProduct.code)?.qty||0)+qty);
   bubble('Đã thêm '+qty+' × '+lastProduct.name+' vào cùng một giỏ hàng.');
   $('productSelection').classList.remove('active');closeCatalogue();
  }catch(e){setText('cartFeedback','⚠ '+e.message)}
 };
 $('quickCartEdit').onclick=()=>{$('inlineCartLines').hidden=!$('inlineCartLines').hidden};
 $('quickCartNew').onclick=()=>{if(confirm('Xóa các món đang chọn?')){cart.clear();invalidate();updateCart();}};
 $('clearCart').onclick=()=>{cart.clear();invalidate();updateCart()};
 $('composeCart').onclick=()=>{quoteNow()};
 $('quickCartQuote').onclick=()=>quoteNow();
 function renderSuggestions(){
  const root=$('suggestionsList');root.replaceChildren();
  if(!catalogue)return;
  for(const p of currentProducts().slice(0,6)){
   const b=document.createElement('button');b.type='button';b.className='suggestion-compact-chip';
   b.textContent='＋ '+p.name.slice(0,32);b.onclick=()=>{try{changeQty(p.code,(cart.get(p.code)?.qty||0)+1)}catch(e){bubble(e.message,'note')}};
   root.append(b);
  }
  setText('suggestionsCaption','Gợi ý từ danh mục thật; chưa phải lịch sử mua hàng cá nhân.');
 }
 $('suggestionsToggle').onclick=()=>{
  const opened=$('suggestionsInline').hidden;
  $('suggestionsInline').hidden=!opened;$('suggestionsList').hidden=!opened;
  $('suggestionsToggle').setAttribute('aria-expanded',String(opened));
 };
 const note=document.createElement('div');note.className='delivery-note-block';
 const noteLabel=document.createElement('label');noteLabel.className='delivery-note-label';noteLabel.textContent='📦 Ghi chú giao hàng';
 const noteInput=document.createElement('textarea');noteInput.className='delivery-note';
 noteInput.placeholder='Ví dụ: Giao trước 14 giờ';noteInput.maxLength=300;
 noteInput.oninput=()=>{deliveryNote=noteInput.value;invalidate()};
 noteLabel.append(noteInput);note.append(noteLabel);
 $('quickCart').append(note);
 function applyCatalogue(d){
  catalogue=d;products.clear();for(const p of d.products||[])products.set(p.code,p);
  if(!products.size)throw Error('Bảng giá Production không có sản phẩm.');
  cart.clear();invalidate();updateCart();renderSuggestions();renderCatalogue();
  setText('chatSubtitle',d.customer.name+' • '+d.customer.location+' • CK '+d.discountPercent+'%');
  bubble('Đã chọn nơi giao '+d.customer.location+'. Giá đã đồng bộ theo chính sách riêng. Anh/chị nhắn món hoặc chọn Tất cả sản phẩm.');
 }
 function renderDestinations(){
  const root=$('locationsPanel');root.replaceChildren();
  const hint=document.createElement('p');hint.className='location-picker-hint';
  hint.textContent='Chọn một địa chỉ đã được Minh Satori duyệt. Không thể tự thay đổi địa chỉ chưa duyệt.';
  root.append(hint);
  for(const d of destinations){
   const button=document.createElement('button');button.type='button';
   button.setAttribute('aria-pressed',String(selectedRef?.id===d.customerRef.id&&selectedRef?.invoiceNo===d.customerRef.invoiceNo));
   button.textContent=d.name+' • '+d.location+' • CK '+d.discountPercent+'%';
   button.onclick=async()=>{
    if(requestsBusy)return;disabledBusy(true);button.disabled=true;
    try{
     const next={id:d.customerRef.id,invoiceNo:d.customerRef.invoiceNo};
     const info=await call('/api/real/catalogue',{destination:next});
     selectedRef=next;applyCatalogue(info);
     $('locationsPanel').hidden=true;$('locationsToggle').setAttribute('aria-expanded','false');
     renderDestinations();
    }catch(e){bubble('Không chọn được điểm giao: '+e.message,'note')}
    finally{disabledBusy(false);button.disabled=false}
   };
   root.append(button);
  }
 }
 $('locationsToggle').onclick=()=>{
  if(!destinations.length)return;
  $('locationsPanel').hidden=!$('locationsPanel').hidden;
  $('locationsToggle').setAttribute('aria-expanded',String(!$('locationsPanel').hidden));
 };
 async function unlock(){
  const entered=$('realCode').value.trim();
  if(!entered)throw Error('Vui lòng nhập mã riêng.');
  accessCode=entered;
  const d=await call('/api/real/catalogue',{});
  $('realGate').hidden=true;$('productionGeminiApp').hidden=false;
  const locationButton=$('locationsToggle');locationButton.hidden=false;
  if(d.agency){
   agency=true;destinations=d.destinations||[];
   if(!destinations.length)throw Error('Link chưa có địa chỉ được duyệt.');
   renderDestinations();$('locationsPanel').hidden=false;locationButton.setAttribute('aria-expanded','true');
   setText('chatSubtitle',(d.agentName||'Đại lý')+' • chọn địa chỉ để bắt đầu');
   bubble('Xin chào! Chọn một địa chỉ giao đã duyệt ở phía trên. Sau đó anh/chị có thể đặt hàng bằng chính khung Gemini này.');
  }else{
   agency=false;destinations=[];
   locationButton.hidden=true;applyCatalogue(d);
  }
  // This is the actual original Gemini UI, not a second re-implemented
  // CSS/HTML shell. Only the backend adapter differs.
  $('quickCart').hidden=true;
 }
 $('realOpen').onclick=async()=>{
  if(requestsBusy)return;disabledBusy(true);
  try{await unlock()}catch(e){status('⚠ '+e.message)}finally{disabledBusy(false)}
 };
 $('realCode').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('realOpen').click()}};
 async function interpretMessage(message){
  if(!catalogue){bubble('Hãy chọn địa chỉ giao trước.','note');return}
  const result=await call('/api/real/interpret',{destination:selectedRef,message});
  if(result.needsClarification){bubble(result.message+' Giỏ hàng chưa thay đổi.');return}
  const next=new Map(cart);
  for(const item of result.items||[]){
   if(!products.has(item.code))throw Error('Mặt hàng không có trong danh mục đã duyệt.');
   const p=products.get(item.code);
   next.set(item.code,{code:item.code,qty:(next.get(item.code)?.qty||0)+item.qty,name:p.name,unit:p.unit});
  }
  validCart(next);
  cart.clear();for(const [k,v] of next)cart.set(k,v);invalidate();updateCart();
  if(result.deliveryNote){
   const n=String(result.deliveryNote).slice(0,300);
   if(!deliveryNote.includes(n)){deliveryNote=[deliveryNote,n].filter(Boolean).join('; ').slice(0,300);noteInput.value=deliveryNote;}
  }
  bubble('Đã thêm vào giỏ chung:\n'+(result.items||[]).map(i=>i.qty+' × '+products.get(i.code).name).join('\n')+
   (result.deliveryNote?'\nGhi chú: '+result.deliveryNote:'')+
   '\n\nXem giỏ và báo giá trước khi đặt.');
 }
 $('sendForm').onsubmit=async e=>{
  e.preventDefault();if(requestsBusy)return;
  const message=$('messageInput').value.trim();if(!message)return;
  disabledBusy(true);
  try{
   await interpretMessage(message);bubble(message,'user');$('messageInput').value='';
  }catch(err){bubble('Chưa nhận được yêu cầu: '+err.message,'note')}
  finally{disabledBusy(false)}
 };
 function showQuote(q){
  const box=document.createElement('article');box.className='quote';
  const heading=document.createElement('h3');heading.textContent='🧾 Hóa đơn dự kiến — CHƯA TẠO';
  box.append(heading);
  for(const item of q.items||[]){
   const row=document.createElement('div');row.className='line';
   const name=document.createElement('span');name.textContent=item.product+' ×'+item.qty+' '+item.unit;
   const amount=document.createElement('strong');amount.textContent=cash(item.unitPrice*item.qty);
   row.append(name,amount);box.append(row);
  }
  for(const [label,value] of [['Tiền hàng',q.subtotal],['Phí giao',q.shippingAmount],['VAT',q.vatAmount],['TỔNG',q.total]]){
   const row=document.createElement('div');row.className='line';
   const name=document.createElement('span');name.textContent=label;
   const amount=document.createElement('strong');amount.textContent=cash(value);
   if(label==='TỔNG')amount.className='total';
   row.append(name,amount);box.append(row);
  }
  const delivery=document.createElement('p');delivery.className='mini';
  delivery.textContent='📍 '+q.customer.name+' • '+q.customer.location;box.append(delivery);
  const confirm=document.createElement('button');confirm.type='button';confirm.className='btn primary live-real-confirm';
  confirm.textContent='✅ Xác nhận tạo MỘT hóa đơn thật';
  confirm.onclick=async()=>{
   if(requestsBusy||!quoteToken)return;
   if(!window.confirm('Xác nhận tạo đúng MỘT hóa đơn thật trên Google Drive?'))return;
   confirm.disabled=true;disabledBusy(true);
   try{
    const saved=await call('/api/real/confirm',{quoteToken,confirmation:'CUSTOMER_CONFIRMS_REAL_ORDER'});
    quoteToken=null;lastReceipt={quote:q,result:saved};
    confirm.textContent='✅ Đã lưu hóa đơn #'+saved.invoiceNo;
    bubble('✅ Minh Satori đã lưu hóa đơn thật #'+saved.invoiceNo+' • '+cash(saved.total)+'. Có thể xem lại hóa đơn trong phiên này.');
    updateSessionReceipt();
   }catch(err){
    bubble('⚠ Trạng thái hóa đơn chưa xác định: '+err.message+' KHÔNG xác nhận lại; liên hệ chủ tài khoản kiểm tra sổ thật.','note');
   }finally{disabledBusy(false)}
  };
  box.append(confirm);$('messages').append(box);$('messages').scrollTop=$('messages').scrollHeight;
 }
 async function quoteNow(){
  if(requestsBusy)return;if(!catalogue){bubble('Chọn địa chỉ trước.','note');return}
  if(!cart.size){bubble('Giỏ đang trống; hãy thêm món trước.','note');return}
  disabledBusy(true);
  try{
   const items=[...cart.values()].map(x=>({code:x.code,qty:x.qty}));
   const q=await call('/api/real/quote',{destination:selectedRef,items,deliveryNote});
   invalidate();quoteToken=q.quoteToken;lastQuote=q;
   showQuote(q);bubble('Anh/chị kiểm tra báo giá và bấm xác nhận trực tiếp trên hóa đơn trong chat.');
  }catch(err){bubble('Không lập được báo giá: '+err.message,'note')}
  finally{disabledBusy(false)}
 }
 function updateSessionReceipt(){
  const root=$('historyItems');root.replaceChildren();
  if(!lastReceipt)return;
  const item=document.createElement('article');item.className='history-item';
  const title=document.createElement('h3');title.textContent='Hóa đơn thật #'+lastReceipt.result.invoiceNo;
  const info=document.createElement('p');info.textContent='Tổng thanh toán: '+cash(lastReceipt.result.total);
  const button=document.createElement('button');button.className='btn';button.textContent='🧾 Xem hóa đơn';
  button.onclick=()=>{showReceipt();$('historyBackdrop').classList.remove('open')};
  item.append(title,info,button);root.append(item);
 }
 function showReceipt(){
  if(!lastReceipt){bubble('Chưa có hóa đơn đã xác nhận trong phiên này.');return}
  const paper=$('printPaper');paper.replaceChildren();
  const h=document.createElement('h2');h.textContent='MINH SATORI — HÓA ĐƠN #'+lastReceipt.result.invoiceNo;
  const p=document.createElement('p');p.textContent=lastReceipt.quote.customer.name+' • '+lastReceipt.quote.customer.location;
  const total=document.createElement('p');total.className='total';total.textContent='TỔNG: '+cash(lastReceipt.result.total);
  const caution=document.createElement('p');caution.className='warn';
  caution.textContent='Hóa đơn đã lưu trên hệ thống. Đây là bản tóm tắt trong chat, không phải PDF gốc.';
  paper.append(h,p,caution);
  for(const row of lastReceipt.quote.items||[]){
   const line=document.createElement('p');line.textContent=row.product+' × '+row.qty+' — '+cash(row.subtotal);paper.append(line);
  }
  paper.append(total);$('invoice').style.display='block';
 }
 $('historyButton').onclick=()=>{$('historyBackdrop').classList.add('open');updateSessionReceipt()};
 $('historyClose').onclick=()=>{$('historyBackdrop').classList.remove('open')};
 $('closeInvoice').onclick=()=>{$('invoice').style.display='none'};
 $('historyExcel').hidden=true;$('viewInvoice').hidden=true;$('printInvoice').hidden=true;
 $('historyMonth')?.closest('label')?.setAttribute('hidden','');
 $('historySearch')?.closest('label')?.setAttribute('hidden','');
 $('locationsPanel').hidden=true;$('suggestionsInline').hidden=true;
 $('quickCart').hidden=true;updateCart();
 $('sendForm').querySelector('button[type=submit]').disabled=false;
 if(!/^[A-Za-z0-9_.-]{80,30000}$/.test(token)){
  status('Đường link không hợp lệ hoặc bị thiếu. Liên hệ Minh Satori để xin lại.');
  $('realOpen').disabled=true;
 }
})();
