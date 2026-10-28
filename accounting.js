/* Minh Satori accounting extension. No invoice migrations or silent payment writes. */
window.Acct=(()=>{
'use strict';
const C=SatoriAccountingCore,KEY='satori_collaborators_v1',MAX_STATE=1500000;
const $=id=>document.getElementById(id),esc=v=>aiEscape(v),money=v=>Math.round(C.number(v)).toLocaleString('vi-VN')+' đ';
const uid=()=>crypto.randomUUID(),registry=()=>JSON.parse(localStorage.getItem(KEY)||'[]');
const model=()=>C.calculate(orders,registry());
let currentReceiptOrder=null,receiptGeneration=0;
function error(e){showModal('Chưa lưu được',esc(e.message||e),'error');}
function sizeCheck(key,value){let size=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('satori_')&&!/recovery|pending|bridge|cloud/.test(k))size+=(k===key?value:localStorage.getItem(k)||'').length;}if(!localStorage.getItem(key))size+=value.length;if(size>MAX_STATE)throw Error('Dữ liệu/chứng từ vượt dung lượng đồng bộ hiện tại. Dùng liên kết Google Drive cho chứng từ lớn; dữ liệu cũ vẫn được giữ nguyên.');}
function saveOrders(next){next=C.preserveReceiptAssets(next,orders);const text=JSON.stringify(next);sizeCheck(STORAGE_KEY,text);localStorage.setItem(STORAGE_KEY,text);orders=next;renderTable();renderArchiveInvoices();updateCounters();}
function patchOrder(id,patch){const found=orders.some(o=>C.key(o)===String(id));if(!found)throw Error('Không còn tìm thấy hóa đơn. Tải lại dữ liệu.');saveOrders(orders.map(o=>C.key(o)===String(id)?{...o,...patch,updatedAt:Date.now()}:o));}
// Customer payment and Satori settlement are independent, auditable facts.
function status(id,value){
 try{
  if(window.__SATORI_DRIVE_APP__ && !window.__SATORI_DRIVE_READY__)
   throw Error('Google Drive chưa đồng bộ. Không thay đổi trạng thái khi sổ chưa sẵn sàng.');
  if(!['Chưa thanh toán','Đã thanh toán','Đã TT Satori','Không Tính','Đã hủy'].includes(value))
   throw Error('Trạng thái thanh toán không hợp lệ.');
  const matches=orders.filter(o=>C.key(o)===String(id));
  if(matches.length!==1)throw Error('Không xác định duy nhất hóa đơn. Tải lại rồi thử lại.');
  const original=matches[0],now=new Date().toISOString();
  const patch={status:value,satoriPaidAt:original.satoriPaidAt||null,
   customerPaidAt:original.customerPaidAt||null};
  if(value==='Đã thanh toán')patch.customerPaidAt=original.customerPaidAt||now;
  else if(value==='Chưa thanh toán')patch.customerPaidAt=null;
  else if(value==='Đã TT Satori'){
   patch.satoriPaidAt=original.satoriPaidAt||now;
   // A prior customer-paid status must survive switching the visible status.
   if(C.paid(original))patch.customerPaidAt=original.customerPaidAt||now;
  }
  patchOrder(id,patch);
  return true;
 }catch(e){error(e);renderTable();return false}
}
// This secondary action can mark/unmark Satori without changing a customer's debt.
function satoriSettlement(id,settled){
 try{
  if(window.__SATORI_DRIVE_APP__ && !window.__SATORI_DRIVE_READY__)
   throw Error('Google Drive chưa đồng bộ. Chưa thể cập nhật thanh toán Satori.');
  if(typeof settled!=='boolean')throw Error('Giá trị thanh toán Satori không hợp lệ.');
  const matches=orders.filter(o=>C.key(o)===String(id));
  if(matches.length!==1)throw Error('Không tìm được duy nhất hóa đơn.');
  const original=matches[0],wasPaid=original.status==='Đã TT Satori'||!!original.satoriPaidAt;
  if(wasPaid===settled)return true;
  if(!settled && !confirm('Hủy đánh dấu đã thanh toán Satori cho hóa đơn này? Lịch sử thanh toán khách hàng vẫn được giữ nguyên.'))
   return false;
  const customerPaid=original.status==='Đã thanh toán'||!!original.customerPaidAt;
  const now=new Date().toISOString();
  const patch={satoriPaidAt:settled?original.satoriPaidAt||now:null};
  if(settled && customerPaid && !original.customerPaidAt)patch.customerPaidAt=now;
  if(original.status==='Đã TT Satori'&&!settled)
   patch.status=customerPaid?'Đã thanh toán':'Chưa thanh toán';
  patchOrder(id,patch);
  return true;
 }catch(e){error(e);renderTable();return false}
}
function formMeta(original){const id=$('acct-form-partner')?.value||'',p=registry().find(p=>p.id===id);return {collaboratorId:id,collaboratorDiscountPercent:id&&original?.collaboratorId===id?original.collaboratorDiscountPercent??p?.discountPercent:p?.discountPercent??null};}
function paymentMeta(original={}){
 const value=$('paymentStatus')?.value||'Chưa thanh toán',now=new Date().toISOString();
 const customerPaidAt=value==='Chưa thanh toán'?null:
  value==='Đã thanh toán'?original.customerPaidAt||now:
  value==='Đã TT Satori'&&C.paid(original)?original.customerPaidAt||now:
  original.customerPaidAt||null;
 return {customerPaidAt,satoriPaidAt:value==='Đã TT Satori'?original.satoriPaidAt||now:original.satoriPaidAt||null};
}
function partnerOptions(selected=''){return '<option value="">Chưa gắn CTV</option>'+registry().filter(p=>p.active!==false||p.id===selected).map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)} · CK ${p.discountPercent}%</option>`).join('');}
function formSelect(id=''){if($('acct-form-partner'))$('acct-form-partner').innerHTML=partnerOptions(id);}
function suggestPartner(contact){const matches=registry().filter(p=>p.active!==false&&(C.norm(p.name)===C.norm(contact.customer)||contact.phone&&aiPhone(p.phone)&&aiPhone(p.phone)===aiPhone(contact.phone)));formSelect(matches.length===1?matches[0].id:'');}
function applyPartnerPrice(){const p=registry().find(p=>p.id===$('acct-form-partner').value);if(!p){showModal('Chọn cộng tác viên','Chọn cộng tác viên trước khi áp dụng giá.','info');return;}currentItems=currentItems.map(i=>{const price=Math.round(i.listPrice*(1-p.discountPercent/100));return {...i,unitPrice:price,discountPercent:p.discountPercent,discountAmount:i.listPrice-price,subtotal:price*i.qty};});renderItemsForm();calculateTotals();}
function partnerForm(id=''){
 const p=registry().find(p=>p.id===id)||{};
 showModal(id?'Sửa cộng tác viên':'Thêm cộng tác viên',`<form id="acct-partner-form" class="space-y-3"><input id="acct-partner-id" type="hidden" value="${esc(id)}"><label class="block">Tên cộng tác viên<input id="acct-partner-name" required maxlength="100" class="rc-input" value="${esc(p.name||'')}"></label><label class="block">Điện thoại<input id="acct-partner-phone" maxlength="60" class="rc-input" value="${esc(p.phone||'')}"></label><label class="block">Chiết khấu giá mua CTV (% trên giá niêm yết)<input id="acct-partner-discount" type="number" required min="0" max="100" step="0.01" class="rc-input" value="${p.discountPercent??35}"></label><label class="block">Ngân hàng / STK nhận tiền<input id="acct-partner-bank" maxlength="150" class="rc-input" value="${esc(p.bank||'')}"></label><label class="block">Ghi chú<input id="acct-partner-note" maxlength="300" class="rc-input" value="${esc(p.note||'')}"></label><p class="text-xs text-slate-400">CK chỉ áp dụng cho đơn gắn CTV sau khi lưu; không thay đổi giá/CK của đơn cũ. Tiền lời một đơn = tiền hàng bán − giá mua CTV, không gồm VAT/ship. Nếu có cặp hóa đơn cao/thấp, ưu tiên chênh lệch hai hóa đơn.</p><button type="submit" class="rc-button">Lưu cộng tác viên</button></form>`,'info');
 $('acct-partner-form').addEventListener('submit',e=>{e.preventDefault();try{const id=$('acct-partner-id').value||uid(),pct=Number($('acct-partner-discount').value),name=$('acct-partner-name').value.trim();if(!name||!Number.isFinite(pct)||pct<0||pct>100)throw Error('Tên và chiết khấu 0–100% là bắt buộc.');const rows=registry(),previous=rows.find(p=>p.id===id)||{};const p={...previous,id,name,phone:$('acct-partner-phone').value.trim(),discountPercent:pct,bank:$('acct-partner-bank').value.trim(),note:$('acct-partner-note').value.trim(),active:true,updatedAt:Date.now()};const next=rows.some(p=>p.id===id)?rows.map(x=>x.id===id?p:x):[...rows,p];const text=JSON.stringify(next);sizeCheck(KEY,text);localStorage.setItem(KEY,text);closeModal();render();formSelect($('acct-form-partner')?.value||'');}catch(e){error(e);}});
}
function assign(id,partnerId){try{const p=registry().find(p=>p.id===partnerId);patchOrder(id,{collaboratorId:p?.id||'',collaboratorDiscountPercent:p?.discountPercent??null});}catch(e){error(e);}}
function settlement(id){const row=model().rows.find(r=>C.key(r.order)===String(id));if(!row?.eligible||!row.partnerId){showModal('Chưa xác định cộng tác viên','Gắn CTV và kiểm tra cặp hóa đơn trước khi ghi nhận trả lời.','info');return;}showModal('Ghi nhận tiền đã trả cộng tác viên',`<form id="acct-settle-form" class="space-y-3"><p>HĐ #${esc(row.order.invoiceNo)} · ${esc(row.partner?.name||'CTV không còn trong danh sách')}<br>Tiền lời: ${money(row.profit)} · Còn phải trả: ${money(row.due)}</p><label class="block">Tổng số tiền đã trả đến nay (đ)<input id="acct-settled" class="rc-input" type="number" min="0" step="1" required value="${row.settled}"></label><p class="text-xs text-slate-400">Đây là ghi sổ, không thực hiện chuyển tiền. Nhập tổng lũy kế để tránh cộng hai lần.</p><button class="rc-button">Lưu số đã trả</button></form>`,'info');$('acct-settle-form').addEventListener('submit',e=>{e.preventDefault();try{const value=Number($('acct-settled').value);if(!Number.isSafeInteger(value)||value<0)throw Error('Số tiền phải là số nguyên không âm.');if(value>Math.max(0,row.profit))throw Error('Số đã trả vượt tiền lời hiện tại. Kiểm tra lại hóa đơn trước khi lưu.');patchOrder(id,{collaboratorPaid:value,collaboratorPaidAt:new Date().toISOString()});closeModal();}catch(e){error(e);}});}
function receiptForm(id){
 const o=orders.find(o=>C.key(o)===String(id));if(!o)return;currentReceiptOrder=String(id);const generation=++receiptGeneration;
 showModal('Chứng từ thanh toán hóa đơn',`<div class="space-y-3"><p>HĐ #${esc(o.invoiceNo)} · ${esc(o.name)} · ${money(C.total(o))}</p><p class="text-xs text-slate-400">Đính kèm ảnh hoặc PDF làm bằng chứng. Không tự xác minh chuyển khoản. Ảnh được nén; PDF tối đa 100 KB. File lớn có thể dùng link Drive. Chứng từ được lưu cùng hóa đơn và đồng bộ Drive.</p><input id="acct-receipt-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><label class="block">Hoặc link chứng từ trên Google Drive<input id="acct-receipt-link" type="url" class="rc-input" placeholder="https://drive.google.com/..."></label><label class="block"><input id="acct-receipt-paid" type="checkbox" checked> Xác nhận khách đã thanh toán hóa đơn này</label><p id="acct-receipt-progress" role="status"></p><button id="acct-save-link" class="rc-button" type="button">Lưu liên kết chứng từ</button><div id="acct-receipt-list"></div></div>`,'info');
 const add=receipt=>{if(generation!==receiptGeneration||currentReceiptOrder!==String(id))throw Error('Cửa sổ hóa đơn đã thay đổi. Mở lại chứng từ để tải lên.');const fresh=orders.find(x=>C.key(x)===String(id));const patch={paymentReceipts:[...(fresh.paymentReceipts||[]),receipt]};if($('acct-receipt-paid')?.checked){patch.customerPaidAt=new Date().toISOString();if(fresh.status!=='Đã TT Satori')patch.status='Đã thanh toán';}patchOrder(id,patch);$('acct-receipt-progress').textContent='Đã lưu trên máy. Xem chấm trạng thái Drive cạnh tên ứng dụng để xác nhận đồng bộ.';renderReceipts(id);};
 $('acct-receipt-file').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{$('acct-receipt-progress').textContent='Đang xử lý chứng từ…';const data=await receiptData(file);add({id:uid(),name:file.name,mime:data.mime,data:data.url,uploadedAt:new Date().toISOString()});}catch(e){if($('acct-receipt-progress'))$('acct-receipt-progress').textContent=e.message;}finally{if($('acct-receipt-file'))$('acct-receipt-file').value='';}});
 $('acct-save-link').addEventListener('click',()=>{try{const url=new URL($('acct-receipt-link').value.trim());if(url.protocol!=='https:'||!['drive.google.com','docs.google.com'].includes(url.hostname))throw Error('Dùng link HTTPS Google Drive hoặc Google Docs.');add({id:uid(),name:'Chứng từ Google Drive',url:url.href,uploadedAt:new Date().toISOString()});$('acct-receipt-link').value='';}catch(e){$('acct-receipt-progress').textContent=e.message;}});renderReceipts(id);
}
async function receiptData(file){
 if(file.size>12*1024*1024)throw Error('Chọn ảnh dưới 12 MB hoặc dùng link Drive.');
 const read=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Không đọc được tệp.'));r.readAsDataURL(blob);});
 if(file.type==='application/pdf'){if(file.size>100000)throw Error('PDF vượt 100 KB. Lưu file vào Drive rồi dán liên kết bên dưới để giữ đủ chất lượng.');if(await file.slice(0,5).text()!=='%PDF-')throw Error('Tệp PDF không hợp lệ.');return {mime:'application/pdf',url:await read(file)};}
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Chỉ nhận ảnh JPG/PNG/WebP hoặc PDF.');
 const source=await read(file),img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Ảnh không đọc được.'));img.src=source;});
 let size=1400,quality=.82,data;
 for(let i=0;i<8;i++){const canvas=document.createElement('canvas'),scale=Math.min(1,size/Math.max(img.width,img.height));canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/jpeg',quality);if(data.length<=140000)return {mime:'image/jpeg',url:data};quality=Math.max(.45,quality-.07);size*=.9;}
 throw Error('Ảnh còn quá lớn. Dùng liên kết Drive để giữ đầy đủ nội dung chứng từ.');
}
let bulkGeneration=0;
function groupScope(){const customer=$('excelFilterCustomer')?.value;return ['Tìm: '+($('searchInput')?.value||$('excelFilterCustomerName')?.value||(customer==='all'?'Tất cả':customer)||'Tất cả'),'Từ '+($('excelFilterFromDate')?.value||'đầu kỳ')+' đến '+($('excelFilterToDate')?.value||'hiện tại')].join(' · ');}
function renderBulkBar(){
 let bar=$('acct-bulk-bar');if(!bar){const anchor=$('excelSubSummary');if(!anchor)return;bar=document.createElement('div');bar.id='acct-bulk-bar';bar.className='my-3 p-3 rounded-xl border border-cyan-700 bg-slate-950 space-y-2';anchor.after(bar);}
 const eligible=filteredOrders().filter(C.active),groups=new Map();
 for(const o of orders)for(const g of o.paymentGroups||[]){if(!groups.has(g.id))groups.set(g.id,{...g,ids:[]});groups.get(g.id).ids.push(C.key(o));}
 const recent=[...groups.values()].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,5);
 bar.innerHTML=`<div class="flex flex-wrap items-center justify-between gap-2"><p><b>${eligible.length} bill hợp lệ trong bộ lọc</b><br><small class="text-slate-400">Ghi thanh toán và upload một chứng từ chung; bỏ qua bill hủy / không tính.</small></p><button id="acct-bulk-open" type="button" class="rc-button" ${eligible.length?'':'disabled'}>Gom bill đang lọc / Upload chung</button></div>${recent.length?'<details><summary class="text-cyan-300 cursor-pointer">Nhóm thanh toán gần đây — upload bổ sung</summary>'+recent.map(g=>`<button type="button" data-payment-group="${esc(g.id)}" class="block text-left p-2 underline text-cyan-300">${esc(new Date(g.at).toLocaleString('vi-VN'))} · ${g.ids.length} bill · ${g.target==='satori'?'Satori':'Khách thanh toán'}</button>`).join('')+'</details>':''}`;
 $('acct-bulk-open').onclick=()=>bulkForm();bar.querySelectorAll('[data-payment-group]').forEach(b=>b.onclick=()=>bulkForm(groups.get(b.dataset.paymentGroup)));
 renderDebtBar(bar);
}
let debtExportBusy=false;
function debtExportData(){
 const customer=$('excelFilterCustomer')?.value||'all';
 return {orders:filteredOrders(),allOrders:orders,customer:[$('excelFilterCustomerName')?.value,customer==='all'?'':customer,$('searchInput')?.value].filter(Boolean).join(' / '),from:$('excelFilterFromDate')?.value||'',to:$('excelFilterToDate')?.value||'',scope:'Trạng thái: '+(($('filterStatus')?.value||'all')==='all'?'Tất cả':$('filterStatus').value)};
}
function renderDebtBar(anchor){
 if(!window.SatoriCustomerDebt)return;
 let box=$('acct-debt-bar');if(!box){box=document.createElement('div');box.id='acct-debt-bar';box.className='my-3 p-3 rounded-xl border border-emerald-700 bg-slate-950';anchor.after(box);}
 try{const data=debtExportData(),p=SatoriCustomerDebt.prepare(data),customers=new Set(p.rows.map(r=>C.norm(r.order.name)));
 box.innerHTML=`<div class="flex flex-wrap items-center justify-between gap-3"><div><b class="text-emerald-300">Công nợ khách theo bộ lọc</b><p>${p.rows.length} bill · ${customers.size} tên khách · Còn phải thu: <b>${money(p.due)}</b></p><small class="text-slate-400">${esc(data.customer||'Tất cả khách trong bộ lọc')} · ${esc(data.from||'Đầu kỳ')} → ${esc(data.to||'Hiện tại')}<br>${esc(data.scope)}. Đã TT Satori không tự giảm nợ khách.${p.excluded.length?'<br>Bỏ qua '+p.excluded.length+' bill hủy / không tính / bill đối chiếu CTV.':''}${p.review?'<br><span class="text-amber-300">Có '+p.review+' bill cùng người nhận / hàng cần đối chiếu trước khi thu tiền.</span>':''}</small></div><button id="acct-debt-export" type="button" class="rc-button" ${p.rows.length&&!debtExportBusy?'':'disabled'}>${debtExportBusy?'Đang tạo Excel…':'Xuất Excel công nợ khách'}</button></div>`;
 $('acct-debt-export').onclick=exportCustomerDebt;
 }catch(e){box.innerHTML='<p class="text-amber-300">Chưa xuất được công nợ: '+esc(e.message)+'</p>';}
}
async function exportCustomerDebt(){
 if(debtExportBusy)return;
 try{const data=JSON.parse(JSON.stringify(debtExportData()));
 if(data.from&&data.to&&data.from>data.to)throw Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
 if(!SatoriCustomerDebt.prepare(data).rows.length)throw Error('Không có hóa đơn bán khách hợp lệ trong bộ lọc này.');
 debtExportBusy=true;renderDebtBar($('acct-bulk-bar'));await SatoriCustomerDebt.download(data);
 }catch(e){showModal('Chưa xuất được Excel',esc(e.message||e),'error');}finally{debtExportBusy=false;renderDebtBar($('acct-bulk-bar'));}
}
let bulkDialogCleanup=null;
function closeBulkDialog(){if(bulkDialogCleanup){const cleanup=bulkDialogCleanup;bulkDialogCleanup=null;cleanup();}}
function showBulkDialog(content){
 closeBulkDialog();
 const previousFocus=document.activeElement,bodyOverflow=document.body.style.overflow,rootOverflow=document.documentElement.style.overflow;
 const overlay=document.createElement('div');overlay.id='acct-bulk-dialog';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','acct-bulk-dialog-title');
 overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;box-sizing:border-box;padding:8px;display:flex;justify-content:center;align-items:stretch;overflow:hidden;background:rgba(2,6,23,.96);color:#e2e8f0;';
 overlay.innerHTML='<style>#acct-bulk-dialog input[type=file]{display:block;width:100%;max-width:100%;min-width:0;font-size:12px}#acct-bulk-dialog input,#acct-bulk-dialog select{box-sizing:border-box;max-width:100%}#acct-bulk-dialog form{margin:0;min-width:0}</style><section style="width:100%;max-width:640px;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #334155;border-radius:14px;background:#0f172a"><header style="flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #334155;background:#0f172a"><h2 id="acct-bulk-dialog-title" style="flex:1;min-width:0;font-size:14px;font-weight:700;margin:0">Nhóm thanh toán</h2><button id="acct-bulk-save" type="submit" form="acct-bulk-form" style="flex:none;min-height:44px;padding:8px 12px;border:1px solid #22d3ee;border-radius:10px;background:#0e7490;color:white;font-size:14px;font-weight:700">Lưu / Save</button><button id="acct-bulk-close" type="button" aria-label="Đóng khung thanh toán" title="Đóng" style="flex:none;min-width:44px;min-height:44px;border:1px solid #64748b;border-radius:10px;background:#334155;color:white;font-size:22px">✕</button></header><div id="acct-bulk-dialog-body" style="flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px;font-size:13px;line-height:1.5;text-align:left;overflow-wrap:anywhere">'+content+'</div></section>';
 document.body.appendChild(overlay);document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';
 const cancel=()=>{bulkGeneration++;closeBulkDialog();};$('acct-bulk-close').onclick=cancel;
 const onKey=e=>{if(e.key==='Escape'){e.preventDefault();cancel();}};overlay.addEventListener('keydown',onKey);
 bulkDialogCleanup=()=>{overlay.removeEventListener('keydown',onKey);overlay.remove();document.body.style.overflow=bodyOverflow;document.documentElement.style.overflow=rootOverflow;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});};
 $('acct-bulk-close').focus({preventScroll:true});
}

function bulkForm(existing=null){
 const ids=existing?.ids||filteredOrders().filter(C.active).map(C.key),members=ids.map(k=>orders.find(o=>C.key(o)===k)).filter(o=>o&&C.active(o));if(!members.length){error(Error('Không có bill hợp lệ trong nhóm.'));return;}
 const scope=existing?.scope||groupScope(),generation=++bulkGeneration,groupId=existing?.id||uid(),opened=new Map(members.map(o=>[C.key(o),JSON.stringify(o)]));
 showBulkDialog(`<form id="acct-bulk-form" class="space-y-3"><p class="text-sm">${esc(scope)}</p><p class="text-xs text-slate-400">Danh sách bên dưới đã được chốt. Đổi bộ lọc hoặc trạng thái sau đó không đưa bill khác vào nhóm. Chỉ ghi sổ; không tự xác minh hay thực hiện chuyển khoản.</p><label class="block"><input id="acct-bulk-all" type="checkbox" checked> Chọn tất cả ${members.length} bill</label><div class="max-h-56 overflow-auto border border-slate-700 rounded-lg">${members.map(o=>`<label class="block p-2 border-b border-slate-800"><input type="checkbox" data-bulk-key="${esc(C.key(o))}" checked> #${esc(o.invoiceNo)} · ${esc(o.name)} · ${esc(o.date)} · ${money(C.total(o))}<small class="block pl-5">${esc(o.status)}</small></label>`).join('')}</div><p id="acct-bulk-total" class="font-bold text-cyan-300"></p><label class="block">Ghi nhận cho bên nào?<select id="acct-bulk-party" class="rc-input"><option value="customer" ${existing?.target!=='satori'?'selected':''}>Khách đã thanh toán cho mình</option><option value="satori" ${existing?.target==='satori'?'selected':''}>Đã thanh toán cho Satori</option></select></label><label class="block"><input id="acct-bulk-paid" type="checkbox" ${existing?'':'checked'}> Ghi đã thanh toán cho các bill đã chọn</label><p class="text-xs text-slate-400">Nếu đã đổi trạng thái từng bill, bỏ chọn ô trên để chỉ gắn chứng từ. Thanh toán khách và Satori được ghi riêng.</p><label class="block">Ảnh / PDF chung cho nhóm<input id="acct-bulk-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label><label class="block">Hoặc liên kết chứng từ Drive<input id="acct-bulk-link" type="url" class="rc-input" placeholder="https://drive.google.com/..."></label><p class="text-xs text-slate-400">Ảnh được nén, PDF tối đa 100 KB; tệp lớn dùng link Drive. Chỉ lưu một bản chứng từ và liên kết tới từng bill. Có thể ghi thanh toán trước, upload sau từ Nhóm thanh toán gần đây.</p><p id="acct-bulk-progress" role="status"></p></form>`);
 const form=$('acct-bulk-form'),checks=()=>[...form.querySelectorAll('[data-bulk-key]')],selected=()=>checks().filter(b=>b.checked).map(b=>b.dataset.bulkKey);
 const summary=()=>{const keys=new Set(selected()),list=members.filter(o=>keys.has(C.key(o)));$('acct-bulk-total').textContent=list.length+' bill · Tổng giá trị các bill: '+money(list.reduce((s,o)=>s+C.total(o),0));$('acct-bulk-all').checked=list.length===members.length;$('acct-bulk-all').indeterminate=!!list.length&&list.length<members.length;};
 $('acct-bulk-all').onchange=e=>{checks().forEach(b=>b.checked=e.target.checked);summary();};checks().forEach(b=>b.onchange=summary);summary();
 let busy=false;form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;busy=true;const button=$('acct-bulk-save');button.disabled=true;button.textContent='Đang lưu…';
  try{
   const keys=selected(),target=$('acct-bulk-party').value,markPaid=$('acct-bulk-paid').checked,file=$('acct-bulk-file').files?.[0],link=$('acct-bulk-link').value.trim();
   if(!keys.length)throw Error('Chọn ít nhất một bill.');if(file&&link)throw Error('Chọn tệp hoặc dùng liên kết Drive, không chọn đồng thời.');if(!markPaid&&!file&&!link)throw Error('Chọn chứng từ hoặc bật ghi đã thanh toán.');
   const before=new Map(keys.map(k=>[k,opened.get(k)]));let receipt=null;
   $('acct-bulk-progress').textContent='Đang chuẩn bị chứng từ chung…';
   if(file){const data=await receiptData(file);receipt={id:uid(),name:file.name,mime:data.mime,data:data.url,uploadedAt:new Date().toISOString()};}
   if(link){const url=new URL(link);if(url.protocol!=='https:'||!['drive.google.com','docs.google.com'].includes(url.hostname))throw Error('Dùng link HTTPS Google Drive hoặc Google Docs.');receipt={id:uid(),name:'Chứng từ nhóm trên Google Drive',url:url.href,uploadedAt:new Date().toISOString()};}
   if(generation!==bulkGeneration||$('acct-bulk-form')!==form)throw Error('Cửa sổ nhóm đã đổi. Mở lại nhóm để lưu.');
   if(keys.some(k=>before.get(k)!==JSON.stringify(orders.find(o=>C.key(o)===k))))throw Error('Có bill đã thay đổi trong lúc xử lý. Mở lại nhóm để kiểm tra trước khi lưu.');
   const next=C.paymentGroup(orders,keys,{id:groupId,target,markPaid,receipt,scope,at:new Date().toISOString()});saveOrders(next);
   closeBulkDialog();closeModal();showModal('Đã cập nhật '+keys.length+' bill',`<p>${markPaid?'Đã ghi thanh toán cho nhóm. ':''}${receipt?'Một chứng từ chung đã được gắn vào từng bill. ':''}Mở Upload / xem của bill bất kỳ để xem chứng từ. Nhóm được giữ trong Nhóm thanh toán gần đây để upload bổ sung.</p><p class="mt-2 text-sm">Đã lưu trên máy; chờ chấm Drive chuyển xanh để xác nhận đồng bộ.</p>`,'success');
  }catch(e){if(generation!==bulkGeneration)return;if($('acct-bulk-form')===form){$('acct-bulk-progress').textContent=e.message;$('acct-bulk-progress').scrollIntoView?.({block:'nearest'});}else error(e);}finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent='Lưu / Save';}}
 });
}

function renderReceipts(id){const o=orders.find(o=>C.key(o)===String(id));const el=$('acct-receipt-list');if(!el||!o)return;el.innerHTML=(o.paymentReceipts||[]).map(r=>`<div class="p-2 border-b border-slate-700"><button type="button" data-open-receipt="${esc(r.id)}" class="text-cyan-300 underline">${esc(r.name)}</button><small class="block">${esc(r.uploadedAt)}${r.groupId?' · Chứng từ chung · '+(r.party==='satori'?'Satori':'Khách thanh toán'):''}</small></div>`).join('')||'<p>Chưa có chứng từ.</p>';el.querySelectorAll('[data-open-receipt]').forEach(b=>b.addEventListener('click',()=>{const r=C.resolveReceipt(o.paymentReceipts.find(r=>r.id===b.dataset.openReceipt),[...orders,...getTrashBinOrders().map(t=>t.order)]);try{if(r.url){const link=new URL(r.url);if(link.protocol!=='https:'||!['drive.google.com','docs.google.com'].includes(link.hostname))throw Error('Liên kết chứng từ không hợp lệ.');window.open(link.href,'_blank','noopener');return;}if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(r.mime)||typeof r.data!=='string'||!r.data.startsWith('data:'+r.mime+';base64,'))throw Error('Loại chứng từ không hợp lệ.');const parts=r.data.split(','),bytes=Uint8Array.from(atob(parts[1]),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:r.mime}));window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){error(e);}}));}
function mount(){
 const section=$('tab-sheet');if(!section||$('acct-panel'))return;
 const el=document.createElement('div');el.id='acct-panel';el.className='bg-slate-950 border border-cyan-700 rounded-2xl p-4 sm:p-6 space-y-4';el.innerHTML=`<div class="flex flex-wrap justify-between gap-3"><div><h2 class="text-lg font-bold text-cyan-300">Cộng tác viên & chứng từ thanh toán</h2><p class="text-xs text-slate-400">Tự tính tiền lời; số đã trả nhập riêng. Không tự chuyển tiền.</p></div><div class="flex gap-2"><button id="acct-add-partner" class="rc-button">Thêm cộng tác viên</button><button id="acct-export" class="rc-button">Xuất toàn bộ Excel (.xlsx)</button></div></div><div id="acct-summary" class="grid grid-cols-2 sm:grid-cols-4 gap-3"></div><details open><summary class="font-bold">Danh sách cộng tác viên</summary><div id="acct-partners" class="overflow-auto"></div></details><details open><summary class="font-bold">Cặp hóa đơn và tiền lời</summary><p class="text-xs text-slate-400">Chỉ tự ghép khi đúng 2 đơn cùng người nhận và cùng từng sản phẩm/số lượng. Khác địa chỉ hoặc nhiều đơn tương tự sẽ đưa vào Cần kiểm tra. Mỗi cặp tính chênh lệch một lần; hóa đơn thấp là bản đối chiếu, không cộng lặp doanh thu.</p><div id="acct-pairs" class="overflow-auto"></div></details><details><summary class="font-bold text-amber-300">Cần kiểm tra trước khi tính lời</summary><div id="acct-review"></div></details><label class="block">Tìm hóa đơn để gắn CTV / upload chứng từ<input id="acct-search" class="rc-input" placeholder="Số hóa đơn, tên, địa chỉ hoặc SĐT"></label><div id="acct-orders" class="overflow-auto max-h-[600px]"></div>`;section.prepend(el);
 $('acct-add-partner').onclick=()=>partnerForm();$('acct-export').onclick=()=>exportWorkbook(false);$('acct-search').oninput=renderOrderList;
 const form=document.createElement('div');form.className='my-3 p-3 border border-cyan-700 rounded-xl';form.innerHTML='<label class="block text-sm font-bold">Cộng tác viên của đơn<select id="acct-form-partner" class="rc-input"></select></label><button type="button" id="acct-apply-price" class="text-xs text-cyan-300 underline mt-2">Áp dụng giá mua CTV vào đơn này</button><p class="text-xs text-slate-400">Gắn CTV không tự đổi giá bán cho khách. Nút trên chỉ dùng khi lập bill giá CTV.</p>';$('paymentStatus')?.parentElement?.appendChild(form);$('acct-apply-price').onclick=applyPartnerPrice;formSelect();$('busName')?.addEventListener('change',()=>suggestPartner({customer:$('busName').value}));
}
function render(){mount();if(!$('acct-panel'))return;const m=model(),primary=m.rows.filter(r=>r.eligible),due=primary.reduce((s,r)=>s+r.due,0);$('acct-summary').innerHTML=[['Cộng tác viên',m.partners.length],['Cặp hóa đơn',m.pairs.length],['Lời CTV phải trả',money(due)],['Nhóm cần kiểm tra',m.review.length]].map(([a,b])=>`<div class="p-3 rounded-xl bg-slate-900"><small>${a}</small><p class="font-bold text-lg">${b}</p></div>`).join('');
 $('acct-partners').innerHTML='<table class="rc-table"><thead><tr><th>CTV / Liên hệ</th><th>CK mua</th><th>Số đơn</th><th>Tiền lời</th><th>Đã trả</th><th>Còn trả</th><th></th></tr></thead><tbody>'+m.partners.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.phone)} · ${esc(p.bank)}</small></td><td>${p.discountPercent}%</td><td>${p.count}</td><td>${money(p.profit)}</td><td>${money(p.settled)}</td><td class="text-amber-300">${money(p.due)}</td><td><button data-edit-partner="${esc(p.id)}" class="text-cyan-300 underline">Sửa</button></td></tr>`).join('')+'</tbody></table>';
 $('acct-partners').querySelectorAll('[data-edit-partner]').forEach(b=>b.onclick=()=>partnerForm(b.dataset.editPartner));
 $('acct-pairs').innerHTML=m.pairs.length?'<table class="rc-table"><thead><tr><th>Người nhận</th><th>Bill cao</th><th>Bill thấp</th><th>Chênh lệch / lời</th><th>CTV</th></tr></thead><tbody>'+m.pairs.map(p=>`<tr><td>${esc(p.high.name)}<br><small>${esc(p.high.location)}</small></td><td>#${esc(p.high.invoiceNo)} · ${money(C.total(p.high))}</td><td>#${esc(p.low.invoiceNo)} · ${money(C.total(p.low))}</td><td class="text-emerald-300">${money(p.profit)}</td><td>${esc(registry().find(x=>x.id===p.collaboratorId)?.name||'Chưa gắn CTV')}</td></tr>`).join('')+'</tbody></table>':'<p class="text-slate-400">Chưa có cặp hóa đơn đủ rõ để tự tính chênh lệch.</p>';
 $('acct-review').innerHTML=m.review.map(g=>`<p class="p-2 border-b border-slate-700">${esc(g.orders.map(o=>'#'+o.invoiceNo+' '+o.name).join(' · '))}<br><span class="text-amber-300">${esc(g.reason)}</span></p>`).join('')||'<p>Không có nhóm cần kiểm tra.</p>';renderOrderList();
}
/* Read-only invoice figures. Customer receivable, gross profit and CTV
   commission are THREE different concepts and must never share a zero label. */
function invoiceBillAmount(o){
 if(o.total!==undefined && o.total!==null && String(o.total).trim()!==''){
  const n=Number(o.total);
  return Number.isFinite(n)&&n>=0?n:null;
 }
 const lines=o.items?.length?o.items:[o];
 if(!lines.some(i=>Number(i.qty)>0 && i.unitPrice!==undefined && i.unitPrice!==null
     && Number.isFinite(Number(i.unitPrice))))return null;
 const n=C.total(o);
 return Number.isFinite(n)&&n>=0?n:null;
}
function ledgerInvoiceFigures(r){
 const o=r.order,bill=invoiceBillAmount(o);
 const included=C.active(o)&&!r.secondary;
 const customerDue=!included?null:bill===null?null:(r.customerPaid?0:bill);
 const lines=o.items?.length?o.items:[o];
 const hasCost=lines.length>0&&lines.every(i=>Number(i.qty)>0
   &&i.listPrice!==undefined&&i.listPrice!==null&&Number.isFinite(Number(i.listPrice))
   &&i.unitPrice!==undefined&&i.unitPrice!==null&&Number.isFinite(Number(i.unitPrice)));
 const grossEstimate=included&&hasCost?getOrderProfit(o):null;
 const ctvBasis=!included?'excluded':r.review?'review':!r.partnerId?'unassigned':!r.partner?'missing':r.eligible?'ready':'review';
 return {bill,customerDue,grossEstimate,included,ctvBasis};
}
function renderOrderList(){
 if(!$('acct-orders'))return;
 const q=C.norm($('acct-search')?.value);
 const all=model().rows;
 const rows=all.filter(r=>!q||C.norm([r.order.invoiceNo,r.order.name,
  r.order.location,r.order.phone].join(' ')).includes(q))
  .sort((a,b)=>Number(b.order.invoiceNo)-Number(a.order.invoiceNo));
 const visible=rows.map(r=>({...r,figures:ledgerInvoiceFigures(r)}));
 const sum=key=>visible.reduce((total,r)=>total+(r.figures.included&&r.figures[key]!==null?r.figures[key]:0),0);
 let aggregate=$('acct-order-totals');
 if(!aggregate){
  aggregate=document.createElement('div');
  aggregate.id='acct-order-totals';
  aggregate.className='grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3';
  $('acct-orders').before(aggregate);
 }
 const unknown=visible.filter(r=>r.figures.included&&r.figures.bill===null).length;
 aggregate.innerHTML=[
  ['Tổng bill đang tìm',money(sum('bill'))],
  ['Còn thu khách',money(sum('customerDue'))],
  ['Lãi gộp ước tính',money(sum('grossEstimate'))]
 ].map(([label,value])=>'<div class="acct-figure p-3 rounded-xl border"><small>'+label+
  '</small><strong class="block text-base font-bold acct-money">'+value+'</strong></div>').join('')+
  (unknown?'<p class="col-span-full text-sm acct-warning">Có '+unknown+
  ' hóa đơn chưa đủ dữ liệu tổng tiền, cần kiểm tra trước khi đối soát.</p>':'');
 $('acct-orders').innerHTML='<table class="rc-table"><thead><tr>'+
  '<th>Hóa đơn / Người nhận</th><th>Tổng bill</th><th>Thanh toán khách / Satori</th>'+
  '<th>Còn thu khách</th><th>Lãi gộp ước tính</th><th>Cộng tác viên</th>'+
  '<th>Lời CTV / Còn trả CTV</th><th>Chứng từ / Ghi trả</th></tr></thead><tbody>'+
  visible.map(r=>{
   const o=r.order,f=r.figures,excluded=!f.included;
   const bill=f.bill===null?'<span class="acct-warning">Chưa đủ dữ liệu</span>':'<b class="acct-money acct-bill">'+money(f.bill)+'</b>';
   const customerDue=excluded?'<span class="acct-note">Không tính vào công nợ khách</span>':
    f.customerDue===null?'<span class="acct-warning">Cần kiểm tra</span>':
    '<b class="acct-money acct-customer-due">'+money(f.customerDue)+'</b>';
   const gross=excluded?'<span class="acct-note">Không hạch toán</span>':
    f.grossEstimate===null?'<span class="acct-warning">Chưa đủ giá vốn</span>':
    '<b class="acct-money acct-gross-estimate">'+money(f.grossEstimate)+'</b>'+
    '<small class="block acct-note">Ước tính theo giá vốn</small>';
   const ctv=f.ctvBasis==='ready'?
    '<div><small>Lời CTV</small><b class="block acct-money acct-ctv-profit">'+money(r.profit)+
    '</b><small>Còn trả CTV</small><b class="block acct-money acct-ctv-due">'+money(r.due)+'</b></div>':
    f.ctvBasis==='unassigned'?'<span class="acct-note">Chưa gắn CTV · không phải 0đ tiền bill</span>':
    f.ctvBasis==='excluded'?'<span class="acct-note">Bill đối chiếu / không tính</span>':
    '<span class="acct-warning">Chưa xác định lời CTV · cần đối chiếu</span>';
   return '<tr><td><strong>#'+esc(o.invoiceNo)+' · '+esc(o.name)+'</strong>'+
    '<br><small>'+esc(o.location)+'</small>'+
    (r.secondary?'<p class="acct-note">Bill thấp đối chiếu; không cộng lặp doanh thu</p>':'')+
    (r.review?'<p class="acct-warning">Cần kiểm tra nhóm trùng</p>':'')+'</td>'+
    '<td>'+bill+'</td>'+
    '<td><span class="'+C.statusClass({status:r.customerPaid?'Đã thanh toán':'Chưa thanh toán'})+
    '">'+(r.customerPaid?'Khách đã TT':'Khách chưa TT')+'</span><br>'+
    '<span class="'+C.statusClass({status:r.satoriPaid?'Đã TT Satori':'Chưa thanh toán'})+
    '">'+(r.satoriPaid?'Đã TT Satori':'Chưa ghi TT Satori')+'</span></td>'+
    '<td>'+customerDue+'</td>'+
    '<td>'+gross+'</td>'+
    '<td><select data-partner-order="'+esc(C.key(o))+
    '" class="rc-input" aria-label="Cộng tác viên hóa đơn '+esc(o.invoiceNo)+'">'+
    partnerOptions(o.collaboratorId)+'</select></td>'+
    '<td title="'+esc(r.basis)+'">'+ctv+'</td>'+
    '<td><button data-receipt-order="'+esc(C.key(o))+
    '" class="text-cyan-300 underline">Upload / xem ('+(o.paymentReceipts?.length||0)+
    ')</button><br>'+(f.ctvBasis==='ready'?
    '<button data-settle-order="'+esc(C.key(o))+
    '" class="text-emerald-300 underline">Ghi đã trả CTV</button>':
    '<small class="acct-note">Chỉ ghi trả khi đã xác minh CTV</small>')+'</td></tr>';
  }).join('')+'</tbody></table>';
 $('acct-orders').querySelectorAll('[data-partner-order]').forEach(b=>b.onchange=()=>assign(b.dataset.partnerOrder,b.value));
 $('acct-orders').querySelectorAll('[data-receipt-order]').forEach(b=>b.onclick=()=>receiptForm(b.dataset.receiptOrder));
 $('acct-orders').querySelectorAll('[data-settle-order]').forEach(b=>b.onclick=()=>settlement(b.dataset.settleOrder));
}
function filteredOrders(){return orders.filter(o=>{const q=$('searchInput')?.value||'',st=$('filterStatus')?.value||'all',customer=$('excelFilterCustomer')?.value||'all',name=C.norm($('excelFilterCustomerName')?.value);return (!q||matchOrderUniversal(o,q))&&(st==='all'||o.status===st)&&(customer==='all'||String(o.name||'').toLowerCase()===customer.toLowerCase())&&C.customerMatches(o,name)&&isOrderInDateRange(o.date,$('excelFilterFromDate')?.value||'',$('excelFilterToDate')?.value||'');});}
async function exportWorkbook(filtered=true,reconciliation=null){try{if(reconciliation&&reconciliation.snapshot!==JSON.stringify(orders))throw Error('Dữ liệu đã thay đổi. Đối chiếu lại trước khi xuất báo cáo.');await SatoriWorkbook.download({reconciliation,orders:filtered?filteredOrders():orders,allOrders:orders,partners:registry(),catalogue,memory:getAIMemory(),scope:filtered?'Theo bộ lọc sổ kế toán':'Toàn bộ dữ liệu'});}catch(e){error(e);}}
const previousRender=renderTable;renderTable=function(){previousRender();render();renderBulkBar();const m=model(),primary=m.rows.filter(r=>C.active(r.order)&&!r.secondary);for(const [id,value] of [['statTotalProfit',primary.reduce((s,r)=>s+getOrderProfit(r.order)-r.profit,0)],['statTotalRevenue',primary.reduce((s,r)=>s+C.total(r.order),0)],['statPaid',primary.filter(r=>r.customerPaid).reduce((s,r)=>s+C.total(r.order),0)],['statUnpaid',primary.filter(r=>!r.customerPaid).reduce((s,r)=>s+C.total(r.order),0)]])if($(id))$(id).textContent=money(value);};
updateStatus=status;exportToExcel=()=>exportWorkbook(true);
const previousEdit=editOrder;editOrder=function(id){const result=previousEdit(id);formSelect(orders.find(o=>o.id===id)?.collaboratorId||'');return result;};
window.addEventListener('load',()=>{if($('syncStatusBadge'))$('syncStatusBadge').textContent='V18.3 · Thanh toán khách / Satori';mount();render();renderBulkBar();});
return {model,registry,render,formMeta,paymentMeta,formSelect,suggestPartner,assign,patchOrder,receiptData,exportWorkbook,exportCustomerDebt,filteredOrders,status,satoriSettlement,bulkForm,renderBulkBar,cancelBulk:()=>{bulkGeneration++;closeBulkDialog();}};
})();





