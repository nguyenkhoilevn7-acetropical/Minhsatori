/**
 * Minh Satori — customer V2 canonical invoice read-only add-on.
 * Paste into the EXISTING owner Apps Script as InvoiceCustomerExactBatch.gs.
 * No doPost, no writes, no global accounting state changes.
 * BotApi read handler: if(action==='orders.getExactBatch')return SatoriInvoiceExactBatch.read(s,p);
 */
var SatoriInvoiceExactBatch=(function(){
  'use strict';

  function need(ok,code,message){
    if(!ok){var e=new Error(message);e.code=code;throw e;}
  }
  function safeMoney(v){
    var x=Number(v);
    need(Number.isSafeInteger(x)&&x>=0&&x<=100000000000,
      'CANONICAL_TOTAL_INVALID','Số tiền không hợp lệ');
    return x;
  }
  function project(o){
    var excluded=o.status==='Đã hủy'||o.status==='Không Tính';
    var lines=Array.isArray(o.items)&&o.items.length?o.items:[{
      product:o.product,name:o.name,qty:o.qty,unit:o.unit,
      listPrice:o.listPrice,unitPrice:o.unitPrice
    }];
    need(lines.length>=1&&lines.length<=40,
      'CANONICAL_LINES_INVALID','Mặt hàng không hợp lệ');
    var items=lines.map(function(line){
      var qty=Number(line.qty),price=safeMoney(line.unitPrice);
      need(Number.isSafeInteger(qty)&&qty>=0&&qty<=100000,
        'CANONICAL_PRICE_INVALID','Số lượng không hợp lệ');
      return {
        name:String(line.product||line.name||'').slice(0,200),
        code:String(line.code||'').slice(0,40),
        unit:String(line.unit||'Thùng').slice(0,30),
        qty:qty,unitPrice:price,
        listPrice:line.listPrice==null?price:safeMoney(line.listPrice),
        discountPercent:Number.isFinite(Number(line.discountPercent))?
          Number(line.discountPercent):0,
        lineTotal:safeMoney(qty*price)
      };
    });
    var goods=safeMoney(items.reduce(function(total,item){
      return total+item.lineTotal;
    },0));
    var shipping=safeMoney(o.shippingAmount||0);
    var vat=safeMoney(o.vatAmount||0);
    var total=safeMoney(o.total);
    need(excluded||goods+shipping+vat===total,
      'CANONICAL_TOTAL_CONFLICT','Tổng hóa đơn chưa đối soát');
    return {
      id:String(o.id),invoiceNo:Number(o.invoiceNo),
      status:String(o.status||'Chưa thanh toán').slice(0,45),
      totalVnd:excluded?0:total,goodsVnd:excluded?0:goods,
      shippingVnd:excluded?0:shipping,vatVnd:excluded?0:vat,
      items:items,customerPaid:!excluded&&
        (o.status==='Đã thanh toán'||!!o.customerPaidAt),
      delivery:{
        recipientName:String(o.name||'').slice(0,120),
        recipientPhone:String(o.phone||'').slice(0,30),
        address:String(o.location||'').slice(0,400)
      },
      deliveryNote:String(o.deliveryNote||'').slice(0,500),
      date:String(o.date||'').slice(0,30),
      updatedAt:o.updatedAt||null,excluded:excluded
    };
  }
  function read(s,p){
    need(p&&Array.isArray(p.refs)&&p.refs.length>=1&&p.refs.length<=20,
      'EXACT_BATCH_INVALID','Danh sách hóa đơn phải có 1–20 phần tử');
    var all=JSON.parse(s.values.satori_orders_v15||'[]');
    need(Array.isArray(all),'INVALID_STATE','Sổ hóa đơn không hợp lệ');
    var used={};
    var result=p.refs.map(function(ref){
      var no=ref&&Number(ref.invoiceNo);
      var id=ref&&String(ref.id||'');
      need(Number.isSafeInteger(no)&&no>0&&
        /^[A-Za-z0-9_-]{1,80}$/.test(id),
        'EXACT_BATCH_INVALID','Sai mã hóa đơn hoặc ID');
      var key=no+'|'+id;
      need(!used[key],'EXACT_BATCH_DUPLICATE','Trùng mã hóa đơn');
      used[key]=true;
      var matches=all.filter(function(order){
        return Number(order.invoiceNo)===no&&String(order.id)===id;
      });
      need(matches.length<=1,'EXACT_BATCH_AMBIGUOUS','Trùng hóa đơn gốc');
      return matches.length?project(matches[0]):{
        id:id,invoiceNo:no,missing:true
      };
    });
    return {revision:s.revision,orders:result};
  }
  return {read:read};
})();
