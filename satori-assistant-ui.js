/* On-device assistant UI. It never reads Zalo credentials, calls AI providers or saves an order. */
(function(){
  'use strict';
  const A=window.SatoriOrderAssistant;
  if(!A)return;
  const anchor=document.getElementById('zaloRawText');
  if(!anchor)return;
  const panel=document.createElement('section');
  panel.id='satori-assistant-panel';
  panel.className='no-print';
  panel.style.cssText='padding:16px;margin:12px 0;border:1px solid #0e7490;border-radius:16px;background:#082f49;color:#e2e8f0';
  panel.innerHTML=[
    "<details open>",
    "<summary style='font-size:15px;font-weight:800;cursor:pointer;color:#a5f3fc'>🤖 Trợ lý Minh Satori MỚI — Lên đơn & Tra công nợ</summary>",
    "<p style='font-size:12px;margin:10px 0;color:#cbd5e1'>Dán tin nhắn Zalo vào đây hoặc hỏi công nợ. Dữ liệu xử lý trong trình duyệt; không đăng nhập hoặc đọc nhóm Zalo. Không tự lưu hóa đơn hoặc đổi trạng thái thanh toán.</p>",
    "<label for='satoriAssistantPrompt' style='display:block;font-weight:650;margin-bottom:6px'>Tin nhắn / câu hỏi</label>",
    "<textarea id='satoriAssistantPrompt' rows='3' maxlength='12000' placeholder='VD: Nhà thuốc Minh Anh, lấy 10 thùng Satori 500ml, địa chỉ 12 Đường A, SĐT... hoặc: Nhà thuốc Minh Anh còn bao nhiêu bill chưa thanh toán?' style='width:100%;box-sizing:border-box;min-height:90px;background:#020617;color:#f8fafc;border:1px solid #67e8f9;border-radius:10px;padding:12px;font:inherit;font-size:13px'></textarea>",
    "<div style='display:flex;gap:8px;flex-wrap:wrap;margin:10px 0'>",
    "<button id='satoriAssistantParse' type='button' style='padding:10px 14px;background:#0284c7;color:white;border-radius:9px;font-weight:700'>📦 Lập đơn nháp</button>",
    "<button id='satoriAssistantDebt' type='button' style='padding:10px 14px;background:#0f766e;color:white;border-radius:9px;font-weight:700'>📊 Hỏi công nợ</button>",
    "<button id='satoriAssistantTransfer' type='button' disabled style='padding:10px 14px;background:#b45309;color:white;border-radius:9px;font-weight:700;opacity:.45'>Đưa vào form hóa đơn</button>",
    "</div>",
    "<div id='satoriAssistantResult' role='status' aria-live='polite' style='white-space:pre-wrap;overflow-wrap:anywhere;background:#0f172a;border-radius:10px;padding:12px;font-size:13px'>Trợ lý mới đang ở chế độ an toàn: chờ anh dán nội dung.</div>",
    "<p style='font-size:11px;color:#a5f3fc;margin-top:10px'>Công nợ tính theo dữ liệu hiện tải trên thiết bị. Hãy đồng bộ Drive trước khi xác nhận khách đã thanh toán. Đơn nháp chỉ chuyển sang form khi anh bấm nút.</p>",
    "</details>"
  ].join('');
  const target=anchor.parentElement;
  target.parentElement.insertBefore(panel,target);
  const input=panel.querySelector('#satoriAssistantPrompt');
  const result=panel.querySelector('#satoriAssistantResult');
  const transfer=panel.querySelector('#satoriAssistantTransfer');
  let draft=null;
  const fmt=n=>Number(n||0).toLocaleString('vi-VN')+'đ';
  const state=()=>({orders:typeof orders!=='undefined'&&Array.isArray(orders)?orders:[],
    catalogue:typeof catalogue!=='undefined'&&Array.isArray(catalogue)?catalogue:[]});
  const show=lines=>{result.textContent=lines.join('\n');};
  const invalidate=()=>{draft=null;transfer.disabled=true;transfer.style.opacity='.45';};
  input.addEventListener('input',invalidate);
  panel.querySelector('#satoriAssistantParse').addEventListener('click',()=>{
    invalidate();
    const p=A.parseOrder(input.value,state());
    if(!p.ok){show(['Chưa đủ điều kiện lập đơn.'].concat(p.reason?[p.reason]:p.issues||[]));return;}
    draft=p;
    show(['ĐƠN NHÁP — CHƯA LƯU','Khách: '+(p.customer||'(chưa rõ)'),
      'SĐT: '+(p.phone||'(chưa rõ)'),'Địa chỉ: '+(p.address||'(cần xác nhận)'),
      ...p.items.map(it=>'• '+it.qty+' '+it.unit+' '+it.product+' × '+fmt(it.unitPrice)+' = '+fmt(it.subtotal)),
      'Tạm tính theo bảng giá hiện có: '+fmt(p.totalEstimate),
      ...(p.issues.length?['CẦN KIỂM TRA:'].concat(p.issues.map(s=>'⚠ '+s)):['Vẫn cần kiểm tra đúng khách và giá trước khi lưu.']),
      'Chọn "Đưa vào form hóa đơn" để kiểm tra/sửa. Không tự lưu.']);
    transfer.disabled=false;transfer.style.opacity='1';
  });
  panel.querySelector('#satoriAssistantDebt').addEventListener('click',()=>{
    invalidate();
    const d=A.debtReport(input.value,state().orders);
    if(!d.ok){show([d.reason]);return;}
    show(['BÁO CÁO KHÁCH: '+d.customer,
      'Tổng số bill: '+d.totalCount,
      'Đã ghi khách thanh toán: '+d.paidCount,
      'Chưa ghi khách thanh toán: '+d.unpaidCount,
      'Giá trị hóa đơn chưa đánh dấu đã thanh toán: '+fmt(d.unpaidTotal),
      ...d.invoices.slice(0,80).map(o=>'• HĐ #'+o.invoiceNo+' ('+o.date+'): '+fmt(o.amount)+' — '+o.status),
      ...(d.invoices.length>80?['Còn '+(d.invoices.length-80)+' hóa đơn; lọc trong Sổ kế toán để xem đầy đủ.']:[]),
      'LƯU Ý: '+d.note]);
  });
  transfer.addEventListener('click',()=>{
    if(!draft||!draft.items.length)return;
    if(typeof currentEditingOrderId!=='undefined'&&currentEditingOrderId){
      show(['Đang sửa hóa đơn khác. Hãy thoát chế độ sửa trước khi đưa đơn nháp mới vào form.']);return;
    }
    if(typeof currentItems==='undefined'||typeof renderItemsForm!=='function'||typeof calculateTotals!=='function'){
      show(['Không tìm thấy biểu mẫu hóa đơn hiện tại. Chưa thay đổi hay lưu dữ liệu nào.']);return;
    }
    const b=document.getElementById('busName'),p=document.getElementById('busPhone'),l=document.getElementById('busLocation'),pay=document.getElementById('paymentStatus');
    if(!b||!p||!l||!pay){show(['Biểu mẫu hóa đơn chưa sẵn sàng. Chưa thay đổi dữ liệu nào.']);return;}
    currentItems=draft.items.map((it,i)=>({...it,id:Date.now()+i}));
    b.value=draft.customer||'';
    p.value=draft.phone||'';
    l.value=draft.address||'';
    // Customer claims about payment are unverified until a person checks the bank.
    pay.value='Chưa thanh toán';
    renderItemsForm();calculateTotals();
    const form=document.getElementById('orderForm');
    if(form&&form.scrollIntoView)form.scrollIntoView({behavior:'smooth',block:'start'});
    show(['Đã điền đơn nháp vào form. Chưa lưu hóa đơn.',
      'Kiểm tra tên khách, giá, VAT, SĐT, địa chỉ, số lượng, trạng thái thanh toán trước khi bấm Lưu.',
      ...draft.issues.map(s=>'⚠ '+s)]);
    invalidate();
  });
})();
