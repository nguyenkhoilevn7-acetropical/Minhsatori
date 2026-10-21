// Read-only regression for original website invoice PDF generator and embedded VietQR.
// Does not access Google Drive or production invoices.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
function fn(name,next){
 const start=html.indexOf('        function '+name+'(');
 assert(start>=0,name+' missing');
 const stop=html.indexOf('        function '+next+'(',start);
 assert(stop>start,'Unable to isolate '+name);
 return html.slice(start,stop);
}
const source=fn('invoicePaymentDetails','invoiceVietQrPayload')+
 fn('invoiceVietQrPayload','invoicePdfShareMessage')+
 fn('invoicePdfDefinition','invoiceQrImage');
const ctx={getOrderGoodsTotal:o=>o.items.reduce((n,i)=>n+i.qty*i.unitPrice,0),
 aiDisplayPercent:n=>Number(n).toFixed(2).replace(/0+$/,'').replace(/\.$/,''),
 moneyToVietnameseWords:n=>String(n)};
vm.createContext(ctx);vm.runInContext(source,ctx);
function parts(raw){const tags={};for(let i=0;i<raw.length;){const tag=raw.slice(i,i+2),len=Number(raw.slice(i+2,i+4));assert(Number.isInteger(len)&&len>=0);tags[tag]=raw.slice(i+4,i+4+len);i+=4+len;}return tags;}
function verify(order,priceExpected,vatExpected){
 const q=ctx.invoiceVietQrPayload(order),payload=q.slice(0,-8)+'6304',checksum=q.slice(-4);
 let crc=0xffff;for(const char of payload){crc^=char.charCodeAt(0)<<8;for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;}
 assert.equal(checksum,crc.toString(16).toUpperCase().padStart(4,'0'));
 const p=parts(q.slice(0,-8));assert.equal(p['00'],'01');assert.equal(p['01'],'12');assert.equal(p['53'],'704');
 assert.equal(p['54'],String(priceExpected));assert.equal(p['58'],'VN');
 const bank=parts(p['38']);assert.equal(bank['00'],'A000000727');assert.equal(bank['02'],'QRIBFTTA');
 const account=parts(bank['01']);assert.equal(account['00'],'970432');assert.equal(account['01'],'658489418');
 assert.equal(parts(p['62'])['08'],'HD'+order.invoiceNo+' Traky Sai Gon');
 const def=ctx.invoicePdfDefinition(order,null,'data:image/jpeg;base64,/9j/2Q==');
 assert.equal(def.pageSize,'A4');const flat=JSON.stringify(def);
 assert(flat.includes('"qr":"'+q+'"'),'website PDF must contain QR even with null external image');
 assert(flat.includes('TỔNG THANH TOÁN'));assert(flat.includes(''+priceExpected.toLocaleString('vi-VN')+' đ'));
 assert(flat.includes(''+vatExpected.toLocaleString('vi-VN')+' đ'));
 return q;
}
const order={id:123,invoiceNo:5928,name:'Traky Sài Gòn',phone:'0931325049',
 date:'21/10/2026',location:'159 Calmette, Quận 1',status:'Chưa thanh toán',
 items:[{product:'Nước tinh khiết Satori 350ml',unit:'Thùng',qty:20,listPrice:88000,unitPrice:65000}],
 shippingAmount:0,vatAmount:104000,vat:'yes'};
const code1=verify(order,1404000,104000);
const code2=verify({...order,items:[{...order.items[0],qty:10}],vatAmount:52000},702000,52000);
assert.notEqual(code1,code2,'changing amount must update QR');
assert(html.includes('const definition=invoicePdfDefinition(o,null,logoImage);'));
assert(!html.includes('const [qrImage,logoImage]=await Promise.all([invoiceQrImage(o),invoiceLogoImage()]);'),'old fail-open network path disabled');
console.log('PASS — VietQR correct VPBank destination, variable amount, CRC16, vector QR present in website PDF definition');
