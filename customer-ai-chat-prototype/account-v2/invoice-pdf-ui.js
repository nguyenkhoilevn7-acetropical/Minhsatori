/* Browser-only original invoice PDF actions. V2 server streams private, verified bytes. */
(function(){
 'use strict';
 let opened=0;
 function pdfButton(text){
  const b=document.createElement('button');b.type='button';
  b.className='btn';b.textContent=text;b.disabled=true;
  b.style.cssText='flex:1 1 120px;min-height:42px;border-radius:12px';
  return b;
 }
 function say(message){
  if(typeof window.toast==='function')window.toast(message);
  else window.alert(message);
 }
 window.satoriPdfOpen=function(order){
  const receipt=order?.receipt,container=document.getElementById('invoiceDetailBody');
  if(!container||!receipt||order.verified!==true||
     order.state!=='COMMITTED'||!Number.isSafeInteger(receipt.invoiceNo))return;
  const sequence=++opened;
  const status=document.createElement('p');
  status.className='invoice-detail-notice';status.setAttribute('role','status');
  status.textContent='Đang kiểm tra PDF chính thức trên Google Drive…';
  const actions=document.createElement('div');
  actions.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 5px';
  const view=pdfButton('👁 Xem PDF'),download=pdfButton('⬇ Tải PDF'),share=pdfButton('↗ Chia sẻ PDF');
  download.classList.add('primary');
  actions.append(view,download,share);
  // Keep the existing honest PDF pending notice when no archived file exists.
  container.append(status,actions);
  if(typeof order.id!=='string'||!/^[0-9a-f-]{36}$/i.test(order.id)){
   status.textContent='PDF gốc chưa có mã hóa đơn xác minh.';return;
  }
  fetch('/api/v2/orders/'+encodeURIComponent(order.id)+'/pdf',{
   method:'GET',credentials:'same-origin',cache:'no-store'
  }).then(async res=>{
   if(!res.ok)throw Error(res.status===404?'PDF_NOT_READY':'PDF_READ_UNAVAILABLE');
   if(!String(res.headers.get('content-type')||'').startsWith('application/pdf'))
    throw Error('PDF_READ_UNAVAILABLE');
   const data=await res.blob();
   if(data.size<100||data.size>3*1024*1024)throw Error('PDF_READ_UNAVAILABLE');
   return data;
  }).then(blob=>{
   if(sequence!==opened||!actions.isConnected)return;
   const filename='MinhSatori_HD'+receipt.invoiceNo+'.pdf';
   const file=new File([blob],filename,{type:'application/pdf'});
   status.textContent='PDF gốc đã xác minh. Có thể xem, tải về hoặc chia sẻ.';
   for(const b of [view,download,share])b.disabled=false;
   view.addEventListener('click',()=>{
    const url=URL.createObjectURL(blob);
    const openedTab=window.open(url,'_blank','noopener');
    if(!openedTab)say('Trình duyệt có thể chặn cửa sổ PDF. Anh hãy chọn Tải PDF.');
    setTimeout(()=>URL.revokeObjectURL(url),120000);
   });
   download.addEventListener('click',()=>{
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
   });
   // File must be loaded BEFORE tap: native sharing requires transient activation.
   share.addEventListener('click',()=>{
    if(typeof navigator.share==='function'&&
       typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})){
      navigator.share({files:[file],title:'Hóa đơn Minh Satori #'+receipt.invoiceNo})
       .catch(e=>{if(e?.name!=='AbortError')say('Không chia sẻ được. Hãy tải PDF rồi gửi qua Zalo.');});
    }else say('Trình duyệt chưa hỗ trợ chia sẻ file PDF. Hãy tải PDF rồi gửi qua Zalo.');
   });
  }).catch(e=>{
   if(sequence!==opened||!actions.isConnected)return;
   status.textContent=e.message==='PDF_NOT_READY'?
    'PDF gốc đang chờ lưu/xác minh trên Drive. Chưa có file chính thức để chia sẻ.':
    'Chưa thể đọc PDF chính thức. Vui lòng thử lại.';
  });
 };
})();
