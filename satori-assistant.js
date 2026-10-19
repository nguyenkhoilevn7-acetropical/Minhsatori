/* Standalone Minh Satori order assistant. No Zalo login, network calls, AI provider or automatic writes. */
(function (root) {
  'use strict';
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d')
      .toLowerCase().replace(/[^a-z0-9.+ ]/g,' ').replace(/\s+/g,' ').trim();
  }
  function phone(s) {
    const m=String(s||'').match(/(?<!\d)(?:\+?84|0)[\s().-]*[35789](?:[\s().-]*\d){8}(?!\d)/);
    if(!m)return '';
    const digits=m[0].replace(/\D/g,'');
    return digits.startsWith('84')?'0'+digits.slice(2):digits;
  }
  function active(o) { return !!o && !['Đã hủy','Không Tính'].includes(o.status); }
  function paid(o) { return o.status === 'Đã thanh toán' || !!o.customerPaidAt; }
  function amount(o) {
    const recorded=Number(o.total);
    if(o.total!=null && Number.isFinite(recorded) && recorded>=0)return recorded;
    const items=Array.isArray(o.items)&&o.items.length?o.items:[o];
    return items.reduce((n,it)=>n+Math.max(0,Number(it.qty)||0)*Math.max(0,Number(it.unitPrice)||0),0);
  }
  function uniqueCustomers(orders) {
    const names=new Map();
    for(const o of orders||[]) {
      if(!active(o)||!String(o.name||'').trim())continue;
      const key=norm(o.name);
      if(!key||['khach vang lai','khach zalo'].includes(key))continue;
      if(!names.has(key))names.set(key,o.name);
    }
    return [...names.values()];
  }
  function customerFromText(text,orders) {
    const hay=' '+norm(text)+' ', digits=String(text).replace(/\D/g,'');
    const candidates=uniqueCustomers(orders).filter(name=>{
      const n=norm(name);
      const noPrefix=n.replace(/^(nha thuoc|cong ty|cty|khach)\s+/,'');
      return (n.length>=5 && hay.includes(' '+n+' ')) ||
        (noPrefix.length>=6 && hay.includes(' '+noPrefix+' ')) ||
        (digits.length>=9 && (orders||[]).some(o=>norm(o.name)===n && phone(o.phone) && digits.includes(phone(o.phone))));
    });
    if(candidates.length===1)return {name:candidates[0],ambiguous:false,known:true};
    if(candidates.length>1)return {name:'',ambiguous:true,known:false};
    const named=String(text).match(/(?:^|[,\n;])\s*((?:nhà thuốc|nha thuoc|công ty|cong ty|cty|khách|khach)\s+[\p{L}\d .-]{3,48})(?=$|[,;\n])/iu);
    return {name:named?named[1].trim():'',ambiguous:false,known:false};
  }
  function inferProduct(text,unit,catalogue,globalBrand) {
    const t=norm(text),unitN=norm(unit);
    const brand=t.includes('hikari')?'hikari':t.includes('satori')?'satori':globalBrand;
    const sizeHit=t.match(/(?:^| )(\d{2,4})\s*(ml|l)(?:$| )/) ||
      t.match(/(?:^| )(\d[.,]\d)\s*l(?:$| )/);
    let size='';
    if(sizeHit)size=sizeHit[2]==='ml'?sizeHit[1]+'ml':sizeHit[1]==='1.5'?'1500ml':sizeHit[1]+'l';
    let candidates=(catalogue||[]).filter(p=>norm(p.unit||'Thùng')===unitN);
    const codeHit=t.match(/tp-\d{5}/);
    if(codeHit)candidates=candidates.filter(p=>norm(p.code)===codeHit[0]);
    else {
      if(brand)candidates=candidates.filter(p=>norm(p.brand||p.name).includes(brand));
      if(size)candidates=candidates.filter(p=>norm(p.name).includes(size));
      const flavour=['mang cau','oi hong','me'].filter(f=>t.includes(f));
      if(flavour.length)candidates=candidates.filter(p=>flavour.some(f=>norm(p.name).includes(f)));
      if(t.includes('khong voi'))candidates=candidates.filter(p=>norm(p.name).includes('khong voi'));
      else if(t.includes('co voi'))candidates=candidates.filter(p=>norm(p.name).includes('co voi')&&!norm(p.name).includes('khong voi'));
      const packs=t.match(/(?:6|12|24)\s*chai/);
      if(packs)candidates=candidates.filter(p=>norm(p.spec).includes(packs[0]));
    }
    if(!codeHit&&!size&&!/(mang cau|oi hong|\bme\b)/.test(t))return null;
    return candidates.length===1?candidates[0]:null;
  }
  function parseOrder(message,{orders=[],catalogue=[]}={}) {
    const raw=String(message||'').trim();
    if(!raw||raw.length>12000)return {ok:false,reason:'Nội dung trống hoặc quá dài (tối đa 12.000 ký tự).',items:[],issues:[]};
    const customer=customerFromText(raw,orders);
    const number=phone(raw);
    const rawBrands=['satori','hikari'].filter(b=>norm(raw).includes(b));
    const globalBrand=rawBrands.length===1?rawBrands[0]:'';
    const regex=/(^|[\s,;:])(\d{1,4})\s*(thùng|thung|két|ket|bình|binh|lốc|loc|chai)(?![\p{L}\d])/gimu;
    const matches=[...raw.matchAll(regex)];
    const items=[],issues=[];
    for(let i=0;i<matches.length;i++){
      const m=matches[i],qty=Number(m[2]);if(qty<1||qty>5000){issues.push('Số lượng không hợp lệ: '+m[2]);continue;}
      const u=norm(m[3]),unit=['thung','ket'].includes(u)?'Thùng':u==='binh'?'Bình':u==='loc'?'Lốc':'Chai';
      const start=m.index+m[0].length;
      const fragment=raw.slice(start,i+1<matches.length?matches[i+1].index:raw.length)
        .split(/[\n;]|(?:dia chi|địa chỉ|sđt|sdt|giao đến|giao den|người nhận|nguoi nhan)\s*[:：]?/i)[0].trim();
      const product=inferProduct(fragment,unit,catalogue,globalBrand);
      if(!product){issues.push('Chưa xác định đúng sản phẩm: '+qty+' '+unit+' '+fragment.slice(0,55));continue;}
      const price=Number(product.unitPrice),list=Number(product.listPrice);
      if(!Number.isFinite(price)||price<0||!Number.isFinite(list)||list<=0){issues.push('Chưa có giá hợp lệ: '+product.name);continue;}
      items.push({code:product.code,product:product.name,unit:product.unit,qty,listPrice:list,unitPrice:price,
        discountPercent:100*(list-price)/list,discountAmount:list-price,subtotal:qty*price,parseSource:'trợ lý mới — giá bảng tham khảo'});
    }
    if(!matches.length)issues.push('Không tìm thấy số lượng kèm đơn vị (thùng, bình, lốc...).');
    if(!customer.name)issues.push(customer.ambiguous?'Nhiều hồ sơ khách có thể trùng; cần xác nhận.':'Chưa nhận diện được khách hàng.');
    if(!number)issues.push('Chưa có số điện thoại; kiểm tra trên form.');
    const addrMatch=raw.match(/(?:địa chỉ|dia chi|giao đến|giao den)\s*[:：]?\s*([^\n;]+)/i);
    let address=addrMatch?addrMatch[1].replace(/(?:sđt|sdt|đt)\s*[:：]?.*$/i,'').trim():'';
    if(/^(cu|cũ|như cũ|nhu cu|lần trước|lan truoc)\b/i.test(address))address='';
    if(!address)issues.push('Cần xác nhận địa chỉ giao hàng.');
    if(/gi[aá]\s*(?:như\s*)?(?:cũ|lần trước)|gia\s*(?:nhu\s*)?(?:cu|lan truoc)/i.test(raw))
      issues.push('Khách yêu cầu giá cũ: cần đối chiếu lịch sử trước khi lưu.');
    if(/đã\s*(?:ck|chuyển|thanh toán|trả)/i.test(raw))issues.push('Khách nói đã thanh toán: cần kiểm tra chứng từ trước khi đánh dấu đã thanh toán.');
    return {ok:items.length>0&&!customer.ambiguous,customer:customer.name,knownCustomer:customer.known,
      phone:number,address,items,issues,source:'nội dung dán thủ công',totalEstimate:items.reduce((v,it)=>v+it.subtotal,0)};
  }
  function debtReport(query,orders=[]) {
    const text=String(query||'').trim();
    if(!text)return {ok:false,reason:'Hãy nhập tên khách hoặc số điện thoại.'};
    const c=customerFromText(text,orders);
    // An explicit name / phone is required: don't disclose every customer's records for a generic question.
    if(!c.name||c.ambiguous)return {ok:false,reason:c.ambiguous?
      'Có nhiều khách phù hợp. Hãy nhập đủ tên hoặc số điện thoại.':
      'Không xác định được khách chính xác. Hãy hỏi với tên đầy đủ hoặc số điện thoại đã lưu.'};
    const key=norm(c.name);
    const rows=(orders||[]).filter(o=>active(o)&&norm(o.name)===key);
    if(!rows.length)return {ok:false,reason:'Không tìm thấy hóa đơn hợp lệ của khách này.'};
    const unpaid=rows.filter(o=>!paid(o));
    const paidRows=rows.filter(paid);
    return {ok:true,customer:c.name,totalCount:rows.length,paidCount:paidRows.length,
      unpaidCount:unpaid.length,unpaidTotal:unpaid.reduce((v,o)=>v+amount(o),0),
      paidTotal:paidRows.reduce((v,o)=>v+amount(o),0),invoices:unpaid.map(o=>({
        invoiceNo:o.invoiceNo??o.id??'Không có mã',date:o.date||'',amount:amount(o),status:o.status||'Chưa ghi'
      })),note:'Đây là số tiền trên hóa đơn chưa đánh dấu khách đã thanh toán; không tự suy ra đã thu đủ tiền hoặc trừ các khoản trả một phần chưa ghi nhận. Hãy đồng bộ dữ liệu mới nhất trước khi đối chiếu.'};
  }
  const engine={parseOrder,debtReport,customerFromText,norm,paid,active};
  if(typeof module!=='undefined'&&module.exports)module.exports=engine;
  root.SatoriOrderAssistant=engine;
})(typeof window!=='undefined'?window:globalThis);
