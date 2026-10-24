/* Authenticated production adapter for the ORIGINAL Gemini UI.
 * Keeps index.html's exact DOM, catalogue sheet, chat, cart and invoice panels.
 * Only source/API access differs. Uses strictly private authenticated real endpoints.
 */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const token=decodeURIComponent(location.hash.slice(1));
 let accessCode='',catalogue=null,selectedRef=null,agency=false,requestsBusy=false;
 let quoteToken=null,lastQuote=null,lastReceipt=null,deliveryNote='',pdfObjectUrl=null;
 let destinations=[],lastProduct=null,historyOrders=[],historyIncomplete=false,newCartSequence=1;
 let submittedCart=false,confirmedReceipts=[];
 const products=new Map(),cart=new Map();
 // Restore the original Gemini Samsung keyboard/viewport behavior.  The
 // production adapter replaces the sandbox JS, so its resize listeners must
 // be reattached here rather than rebuilding the UI.
 function syncVisibleHeight(){
  const vv=window.visualViewport;
  const pixels=Math.max(180,Math.floor(vv?.height>0?
   Math.min(window.innerHeight||vv.height,vv.height):window.innerHeight));
  document.documentElement.style.setProperty('--satori-visible-height',pixels+'px');
 }
 syncVisibleHeight();
 window.visualViewport?.addEventListener('resize',syncVisibleHeight,{passive:true});
 window.visualViewport?.addEventListener('scroll',syncVisibleHeight,{passive:true});
 window.addEventListener('resize',syncVisibleHeight,{passive:true});
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
  for(const b of document.querySelectorAll('.live-real-confirm')){
   if(b.dataset.submitted==='true')continue;
   b.disabled=true;b.textContent='⚪ Báo giá đã thay đổi • cần kiểm tra lại';
  }
 }
 function currentProducts(){
  return [...products.values()];
 }
 let cartCollapsed=true;
 function updateCart(){
  const entries=[...cart.values()],count=entries.reduce((n,x)=>n+x.qty,0);
  setText('quickCartCount','🛒 Giỏ hàng chung • '+entries.length+' loại / '+count+' đơn vị');
  setText('cartCount',entries.length+'/6');
  setText('composeCart','Soạn tin nhắn đầy đủ ('+entries.length+' món) →');
  setText('cartFeedback',entries.length?'Giỏ chung đã cập nhật. Chưa tạo hóa đơn.':'Giỏ đang trống.');
  $('quickCart').hidden=!entries.length;
  $('composeCart').disabled=!entries.length;
  $('quickCartQuote').disabled=!entries.length;
  $('quickCartQuote').hidden=!entries.length;
  $('quickCartEdit').textContent=cartCollapsed?'Mở giỏ':'Thu gọn giỏ';
  $('quickCartEdit').setAttribute('aria-expanded',String(!cartCollapsed));
  const list=$('inlineCartLines'),sheet=$('cartList');list.replaceChildren();sheet.replaceChildren();
  list.hidden=cartCollapsed;
  if(typeof note!=='undefined')note.hidden=cartCollapsed;
  if(!entries.length){
   const empty=document.createElement('span');empty.className='cart-empty';
   empty.textContent='Giỏ chưa có món.';sheet.append(empty);
  }
  for(const item of entries){
   // Reuse original .inline-cart-row/.suggestion-steps CSS: title, stepper,
   // remove are THREE grid children. The previous two-child markup left an
   // empty grid column and pushed the + button off-screen on Samsung.
   const row=document.createElement('div');row.className='inline-cart-row';
   const title=document.createElement('span');title.textContent=item.name;
   title.title=item.name;
   const amount=document.createElement('strong');amount.className='inline-qty-label';
   amount.textContent=' ×'+item.qty+' '+item.unit;title.append(amount);
   const controls=document.createElement('span');controls.className='suggestion-steps';
   const minus=document.createElement('button');minus.type='button';minus.textContent='−';
   minus.setAttribute('aria-label','Giảm '+item.name);
   minus.onclick=()=>changeQty(item.code,item.qty-1);
   const qty=document.createElement('input');qty.type='number';qty.min='0';qty.max='500';qty.step='1';qty.value=String(item.qty);
   qty.setAttribute('aria-label','Số lượng '+item.name);
   qty.onchange=()=>{
    const next=Number(qty.value);
    try{changeQty(item.code,next)}catch(e){bubble(e.message,'note');updateCart();}
   };
   const plus=document.createElement('button');plus.type='button';plus.textContent='＋';
   plus.setAttribute('aria-label','Thêm '+item.name);
   plus.onclick=()=>changeQty(item.code,item.qty+1);
   controls.append(minus,qty,plus);
   const remove=document.createElement('button');remove.type='button';
   remove.className='inline-cart-remove';remove.textContent='×';
   remove.setAttribute('aria-label','Bỏ '+item.name);
   remove.onclick=()=>changeQty(item.code,0);
   row.append(title,controls,remove);list.append(row);
   // Cart inside the ORIGINAL catalogue sheet, not a second custom grid.
   const itemRow=document.createElement('div');itemRow.className='cart-row';
   const label=document.createElement('span');label.className='cart-name';
   label.textContent=item.name+' • '+item.unit;
   const edit=document.createElement('input');edit.className='cart-qty';edit.type='number';
   edit.min='0';edit.max='500';edit.step='1';edit.value=String(item.qty);
   edit.setAttribute('aria-label','Số lượng '+item.name);
   edit.onchange=()=>{try{changeQty(item.code,Number(edit.value))}catch(e){bubble(e.message,'note');updateCart();}};
   const del=document.createElement('button');del.type='button';del.className='cart-remove';
   del.textContent='×';del.setAttribute('aria-label','Bỏ '+item.name);
   del.onclick=()=>changeQty(item.code,0);
   itemRow.append(label,edit,del);sheet.append(itemRow);
  }
 }
 function changeQty(code,qty){
  if(submittedCart)throw Error('Đơn trước đã gửi. Bấm “＋ Giỏ hàng mới” trước khi mua tiếp.');
  if(!Number.isSafeInteger(qty)||qty<0||qty>500)throw Error('Số lượng không hợp lệ.');
  if(!products.has(code))throw Error('Mặt hàng không thuộc bảng giá được duyệt.');
  const next=new Map(cart);if(qty===0)next.delete(code);
  else {const p=products.get(code);next.set(code,{code,qty,name:p.name,unit:p.unit})}
  validCart(next);
  cart.clear();for(const [k,v] of next)cart.set(k,v);
  invalidate();updateCart();
  if($('catalogBackdrop').classList.contains('open'))renderCatalogue();
 }
 function category(p){
  const name=String(p.name||'').toLowerCase();
  if(name.includes('hikari'))return 'HIKARI';
  if(name.includes('juice')||name.includes('ép'))return 'JUICE';
  return 'SATORI';
 }
 let catalogFilter='ALL';
 function renderCatalogue(){
  const root=$('catalogItems'),scroll=root.scrollTop;root.replaceChildren();
  const search=($('catalogSearch').value||'').toLocaleLowerCase('vi');
  const arr=currentProducts().filter(p=>
   (catalogFilter==='ALL'||category(p)===catalogFilter)&&
   (!search||(p.name+' '+p.code).toLocaleLowerCase('vi').includes(search)));
  setText('catalogDescription',currentProducts().length+' sản phẩm từ hệ thống thật • giá theo chiết khấu '+(catalogue?.discountPercent??0)+'%');
  for(const p of arr){
   const row=document.createElement('div');row.className='catalog-item real-catalog-row';
   const current=cart.get(p.code)?.qty||0;
   row.classList.toggle('in-cart',current>0);
   row.setAttribute('data-sku',p.code);
   const info=document.createElement('button');info.type='button';info.className='real-product-picker';
   const logo=document.createElement('span');logo.className='catalog-icon';logo.textContent=category(p)==='JUICE'?'🍹':'💧';
   const label=document.createElement('span');label.className='catalog-label';label.textContent=p.name;
   const secondary=document.createElement('small');
   secondary.textContent='Sau CK '+(catalogue?.discountPercent??0)+'%: '+cash(p.unitPrice)+' / '+p.unit+
    (p.unitPrice<p.listPrice?' • Giá gốc '+cash(p.listPrice):'');
   label.append(secondary);info.append(logo,label);
   const steps=document.createElement('div');steps.className='real-catalog-stepper';
   const minus=document.createElement('button');minus.type='button';minus.className='real-step minus';
   minus.textContent='−';minus.setAttribute('aria-label','Giảm '+p.name);
   const value=document.createElement('input');value.type='number';value.min='0';value.max='500';value.step='1';
   value.inputMode='numeric';value.value=String(current);
   value.setAttribute('aria-label','Số lượng '+p.name);
   const plus=document.createElement('button');plus.type='button';plus.className='real-step plus';
   plus.textContent='＋';plus.setAttribute('aria-label','Thêm một '+p.name);
   const apply=qty=>{try{changeQty(p.code,qty)}catch(err){
    value.value=String(cart.get(p.code)?.qty||0);
    setText('cartFeedback','⚠ '+err.message);
   }};
   plus.onclick=()=>apply((cart.get(p.code)?.qty||0)+1);
   minus.onclick=()=>apply(Math.max(0,(cart.get(p.code)?.qty||0)-1));
   value.onchange=()=>apply(value.value===''?0:Number(value.value));
   info.onclick=()=>{
    lastProduct=p;
    setText('selectedProductName',p.name+' • giá sau CK '+cash(p.unitPrice)+' / '+p.unit);
    $('selectedQuantity').value=String(Math.max(1,cart.get(p.code)?.qty||1));
    $('productSelection').classList.add('active');
    for(const el of root.querySelectorAll('.real-catalog-row'))el.classList.remove('is-selected');
    row.classList.add('is-selected');
   };
   steps.append(minus,value,plus);row.append(info,steps);root.append(row);
  }
  root.scrollTop=scroll;
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
   changeQty(lastProduct.code,qty);
   bubble('Đã cập nhật '+lastProduct.name+' thành '+qty+' '+lastProduct.unit+' trong giỏ hàng.');
   $('productSelection').classList.remove('active');closeCatalogue();
  }catch(e){setText('cartFeedback','⚠ '+e.message)}
 };
 $('quickCartEdit').onclick=()=>{cartCollapsed=!cartCollapsed;updateCart()};
 function startNewCart(){
  if(requestsBusy)return;
  if(cart.size&&quoteToken&&!window.confirm('Hủy báo giá chưa xác nhận để tạo đơn hàng mới?'))return;
  for(const b of document.querySelectorAll('.live-real-confirm')){
   b.disabled=true;b.textContent='Báo giá đã kết thúc';
  }
  cart.clear();invalidate();deliveryNote='';noteInput.value='';lastProduct=null;
  newCartSequence+=1;submittedCart=false;cartCollapsed=true;updateCart();
  bubble('🛒 Giỏ mới #'+newCartSequence+' đã sẵn sàng. Hóa đơn cũ vẫn lưu trong mục Hóa đơn. Anh/chị chọn món hoặc nhắn đơn mới.');
  $('messageInput').focus();
 }
 $('quickCartNew').onclick=startNewCart;
 const createNextButton=document.createElement('button');
 createNextButton.type='button';createNextButton.id='realNewCartButton';
 createNextButton.textContent='＋ Giỏ hàng mới';
 createNextButton.style.cssText='background:#0c76cc;color:#fff;border:0;border-radius:10px;padding:7px 10px;font-weight:750;min-height:39px';
 createNextButton.onclick=startNewCart;
 $('historyButton').parentElement.append(createNextButton);
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
  setText('chatSubtitle',d.customer.name+' • 📞 '+d.customer.phone+' • 📍 '+d.customer.location+' • CK '+d.discountPercent+'%');
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
   button.textContent='📍 '+d.name+' • ☎ '+(d.phone||'Chưa có số')+' • '+d.location+' • CK '+d.discountPercent+'%';
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
  // The server now uses the original sandbox's change semantics and verifies
  // that ALL recognized items fit an atomic basket update before replying.
  const oldRows=[...cart.values()].map(({code,qty})=>({code,qty}));
  const result=await call('/api/real/interpret',{destination:selectedRef,message,cart:oldRows});
  if(result.needsClarification){bubble(result.message+' Giỏ hàng chưa thay đổi.');return}
  const rows=result.cart;
  if(!Array.isArray(rows))throw Error('Phản hồi giỏ hàng không hợp lệ.');
  const next=new Map();
  for(const item of rows){
   if(!products.has(item.code)||next.has(item.code)||
      !Number.isSafeInteger(item.qty)||item.qty<1||item.qty>500)
    throw Error('Sản phẩm hoặc số lượng không khớp bảng giá.');
   const p=products.get(item.code);
   next.set(item.code,{code:item.code,qty:item.qty,name:p.name,unit:p.unit});
  }
  validCart(next);
  cart.clear();for(const [k,v] of next)cart.set(k,v);
  invalidate();updateCart();
  if(result.deliveryNote){
   const n=String(result.deliveryNote).slice(0,300);
   if(!deliveryNote.includes(n)){
    deliveryNote=[deliveryNote,n].filter(Boolean).join('; ').slice(0,300);
    noteInput.value=deliveryNote;
   }
  }
  bubble(result.message||'Đã cập nhật giỏ, chưa tạo hóa đơn.');
 }
 $('sendForm').onsubmit=async e=>{
  e.preventDefault();if(requestsBusy)return;
  const message=$('messageInput').value.trim();if(!message)return;
  // This was the screenshot regression: old code posted the ASSISTANT reply
  // before displaying the user's own message. Old Gemini shows USER first.
  bubble(message,'user');$('messageInput').value='';
  disabledBusy(true);
  const loading=bubble('Đang kiểm tra yêu cầu đặt nước…','note');
  try{await interpretMessage(message)}
  catch(err){bubble('Chưa nhận được yêu cầu: '+err.message,'note')}
  finally{loading.remove();disabledBusy(false)}
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
    bubble('✅ Minh Satori đã lưu hóa đơn thật #'+saved.invoiceNo+' • '+cash(saved.total)+'. Bấm ＋ Giỏ hàng mới để đặt đơn tiếp theo; mọi hóa đơn xem trong mục Hóa đơn.');
    updateSessionReceipt();
    // After successful ledger write, display the canonical PDF from the
    // website template in chat, never the manually formatted 0đ summary.
    await showReceipt();
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
  // Rendered from authoritative Drive ledger whenever the invoice tab opens;
  // do not pretend the last in-memory order is full account history.
  if($('historyBackdrop').classList.contains('open'))void loadInvoiceHistory();
 }
 function renderInvoiceHistory(){
  const root=$('historyItems');root.replaceChildren();
  const month=$('historyMonth').value,term=($('historySearch').value||'').trim().toLocaleLowerCase('vi'),
   state=$('historyStatus')?.value||'';
  const rows=historyOrders.filter(o=>
   (!month||((()=>{const v=String(o.date||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return v?v[3]+'-'+v[2].padStart(2,'0'):String(o.date).slice(0,7)})())===month)&&
   (!state||(state==='paid'&&o.paid)||(state==='unpaid'&&!o.paid))&&
   (!term||String(o.invoiceNo).includes(term)||[o.name,o.location,o.phone,...o.items.map(i=>i.product)]
     .join(' ').toLocaleLowerCase('vi').includes(term)));
  setText('historyCount',rows.length+' hóa đơn phù hợp'+
   (historyIncomplete?' • dữ liệu chưa đầy đủ':'')+' • Google Drive');
  if(!rows.length){const p=document.createElement('p');p.className='mini';
   p.textContent=historyOrders.length?'Không có hóa đơn phù hợp bộ lọc.':'Không có hóa đơn trong phạm vi link đã duyệt.';
   root.append(p);}
  for(const o of rows){
   const card=document.createElement('article');card.className='real-history-order';
   const title=document.createElement('strong');title.textContent='🧾 #'+o.invoiceNo+' • '+o.date;
   const status=document.createElement('small');
   status.textContent=(o.paid?'✅ Đã thanh toán':'🟠 Chưa thanh toán')+
    ' • '+cash(o.total)+(o.paidAt?' • Ngày thanh toán: '+o.paidAt.slice(0,10):'');
   const receiver=document.createElement('small');
   receiver.textContent='👤 '+o.name+' • ☎ '+o.phone+' • 📍 '+o.location;
   const items=document.createElement('small');
   items.textContent=(o.items||[]).map(i=>i.product+' ×'+i.qty).join('; ');
   const open=document.createElement('button');open.type='button';open.textContent='👁 Xem PDF hóa đơn';
   open.onclick=()=>{
    lastReceipt={result:{invoiceNo:o.invoiceNo,total:o.total,receiptToken:o.receiptToken}};
    $('historyBackdrop').classList.remove('open');void showReceipt();
   };
   card.append(title,status,receiver,items,open);root.append(card);
  }
 }
 async function loadInvoiceHistory(){
  $('historyBackdrop').classList.add('open');
  setText('historyCount','Đang đọc hóa đơn thật từ Google Drive…');
  try{
   const d=await call('/api/real/history');
   if(!Array.isArray(d.orders)||!Number.isSafeInteger(d.revision))
    throw Error('Nguồn lịch sử không hợp lệ.');
   historyOrders=d.orders;historyIncomplete=!d.complete;
   const months=[...new Set(historyOrders.map(o=>{
    const m=String(o.date||'').match(/(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})$/);
    return m?m[2]+'-'+m[1].padStart(2,'0'):'';
   }).filter(Boolean))].sort().reverse();
   const select=$('historyMonth'),previous=select.value;
   select.replaceChildren(new Option('Tất cả thời gian',''));
   for(const m of months)select.append(new Option(m.split('-').reverse().join('/'),m));
   select.value=months.includes(previous)?previous:'';
   const notice=document.querySelector('#historyBackdrop .history-caution');
   if(notice)notice.textContent=d.complete?
    '✅ Hóa đơn thật từ Google Drive • Chỉ tên, điện thoại, địa chỉ đã duyệt. Thanh toán cập nhật theo dữ liệu hiện hành.':
    '⚠ Kết quả hiện chưa đầy đủ do giới hạn 100 hóa đơn mỗi lần đọc. Không dùng số liệu này để chốt công nợ.';
   renderInvoiceHistory();
  }catch(e){
   rootHistoryError(e.message);
  }
 }
 function rootHistoryError(message){
  setText('historyCount','Chưa thể đọc đầy đủ lịch sử hóa đơn');
  const root=$('historyItems');root.replaceChildren();
  const warning=document.createElement('p');warning.className='warn';
  warning.textContent='⚠ '+message+' • Không thay bằng dữ liệu thử.';root.append(warning);
 }
 function invoiceLine(label,value,css=''){
  const row=document.createElement('div');row.className='real-invoice-line '+css;
  const a=document.createElement('span');a.textContent=label;
  const b=document.createElement('strong');b.textContent=value;
  row.append(a,b);return row;
 }
 function showVerifiedInvoicePreview(o){
  const preview=document.createElement('article');preview.className='real-invoice-preview';
  const header=document.createElement('h3');header.textContent='MINH SATORI • HÓA ĐƠN #'+o.invoiceNo;
  const person=document.createElement('p');person.textContent='Khách: '+o.name+' • '+o.phone;
  const address=document.createElement('p');address.textContent='Giao: '+o.location;
  const date=document.createElement('p');date.textContent='Ngày: '+o.date+
   ' • '+(o.paid?'Đã thanh toán':'Chưa thanh toán');
  preview.append(header,person,address,date);
  let goods=0;
  for(const item of o.items){
   const amount=Number(item.subtotal??item.qty*item.unitPrice);
   goods+=amount;
   preview.append(invoiceLine(item.product+' × '+item.qty+' '+(item.unit||''),
    cash(amount)));
  }
  preview.append(invoiceLine('Tiền hàng',cash(goods)));
  preview.append(invoiceLine('Phí giao',cash(o.shippingAmount||0)));
  preview.append(invoiceLine('VAT',cash(o.vatAmount||0)));
  preview.append(invoiceLine('TỔNG THANH TOÁN',cash(o.total),'real-invoice-total'));
  if(o.paidAt){
   const paid=document.createElement('p');paid.textContent='Thanh toán: '+o.paidAt;
   preview.append(paid);
  }
  const tip=document.createElement('small');
  tip.textContent='Bản xem trước lấy từ cùng hóa đơn đã lưu trên Google Drive. Mở PDF hoặc tải PDF để xem bản website chính thức.';
  preview.append(tip);
  return preview;
 }
 async function showReceipt(){
  if(!lastReceipt?.result?.receiptToken){
   bubble('Không có hóa đơn thật được xác minh trong phiên này.','note');return;
  }
  const paper=$('printPaper'),invoiceNo=lastReceipt.result.invoiceNo;
  $('invoice').style.display='block';paper.replaceChildren();
  const loading=document.createElement('p');
  loading.textContent='Đang tải hóa đơn thật #'+invoiceNo+' từ Google Drive…';
  paper.append(loading);
  $('viewInvoice').hidden=true;$('printInvoice').hidden=true;
  try{
   const req={receiptToken:lastReceipt.result.receiptToken};
   const details=await call('/api/real/invoice-details',req);
   if(!details.invoice||Number(details.invoice.invoiceNo)!==Number(invoiceNo))
    throw Error('Chi tiết hóa đơn không khớp sổ gốc.');
   const response=await fetch('/api/real/pdf',{method:'POST',cache:'no-store',
    headers:{'content-type':'application/json'},credentials:'omit',
    body:JSON.stringify({token,accessCode,...req})});
   if(!response.ok){
    const data=await response.json().catch(()=>({}));
    throw Error(data.message||'Chưa tải được PDF chính thức.');
   }
   const blob=await response.blob();
   if(blob.type!=='application/pdf'||blob.size<100||blob.size>3*1024*1024)
    throw Error('Dữ liệu PDF không hợp lệ.');
   if(pdfObjectUrl)URL.revokeObjectURL(pdfObjectUrl);
   pdfObjectUrl=URL.createObjectURL(blob);
   paper.replaceChildren();
   const preview=showVerifiedInvoicePreview(details.invoice);
   paper.append(preview);
   // Samsung Internet often renders POST-fetched blob PDF in an iframe as a
   // blank grey panel. Show verified full invoice HTML immediately instead;
   // on supported browsers offer a secondary inline embedded PDF.
   const samsung=/SamsungBrowser/i.test(navigator.userAgent||'');
   if(!samsung){
    const detailsTag=document.createElement('details');
    const summary=document.createElement('summary');summary.textContent='Xem bản PDF trong trang';
    const iframe=document.createElement('iframe');iframe.title='PDF Minh Satori #'+invoiceNo;
    iframe.src=pdfObjectUrl;iframe.style.cssText='width:100%;height:66dvh;border:0;background:white';
    detailsTag.append(summary,iframe);paper.append(detailsTag);
   }
   $('viewInvoice').href=pdfObjectUrl;$('viewInvoice').hidden=false;
   $('viewInvoice').textContent='👁 Mở PDF chính thức';
   $('printInvoice').href=pdfObjectUrl;$('printInvoice').hidden=false;
   $('printInvoice').download='MinhSatori-'+invoiceNo+'.pdf';
   $('printInvoice').textContent='⬇ Tải PDF';
  }catch(err){
   paper.replaceChildren();
   const warning=document.createElement('p');warning.className='warn';
   warning.textContent='⚠ '+err.message+' • Không gửi lại đơn hàng đã tạo.';
   paper.append(warning);
  }
 }
 $('historyButton').onclick=()=>void loadInvoiceHistory();
 $('historyMonth').onchange=renderInvoiceHistory;
 $('historySearch').oninput=renderInvoiceHistory;
 $('historyStatus').onchange=renderInvoiceHistory;
 $('historyClose').onclick=()=>{$('historyBackdrop').classList.remove('open')};
 $('closeInvoice').onclick=()=>{$('invoice').style.display='none'};
 $('historyExcel').hidden=true;$('viewInvoice').hidden=true;$('printInvoice').hidden=true;
 $('locationsPanel').hidden=true;$('suggestionsInline').hidden=true;
 $('quickCart').hidden=true;updateCart();
 $('sendForm').querySelector('button[type=submit]').disabled=false;
 if(!/^[A-Za-z0-9_.-]{80,30000}$/.test(token)){
  status('Đường link không hợp lệ hoặc bị thiếu. Liên hệ Minh Satori để xin lại.');
  $('realOpen').disabled=true;
 }
})();
