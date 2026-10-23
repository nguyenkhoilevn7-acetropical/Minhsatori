/**
 * Website-EXACT pdfmake document definition, extracted from index.html main (ea7cdfb9b927c55114d3186b5ca8291b9350ebf6).
 * Headless worker uses the SAME definitions as browser, not ReportLab or another layout.
 * Never call with untrusted customer data or emit customer details into logs.
 * Re-extract from main and rerun parity tests whenever index.html invoice PDF code changes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const pdfMake=require('pdfmake/build/pdfmake.js');
const fontModule=require('pdfmake/build/vfs_fonts.js');
const fonts=fontModule.pdfMake?.vfs||fontModule.vfs||fontModule;
if(!fonts['Roboto-Regular.ttf'])throw Error('PDF_ROBOTO_VFS_MISSING');
pdfMake.vfs=fonts;
const HERE=path.dirname(fileURLToPath(import.meta.url));
export const PDF_TEMPLATE_VERSION='SATORI_PDF_VIETQR_20261021';

function getOrderGoodsTotal(o) {
            return (o.items?.length ? o.items : [o]).reduce((sum, it) => sum + Number(it.qty ?? 0) * Number(it.unitPrice ?? 0), 0);
        }

function aiDisplayPercent(value) {return Number(value || 0).toLocaleString('vi-VN',{maximumFractionDigits:2});}

function moneyToVietnameseWords(amount) {
            if (!amount || amount <= 0) return "Không đồng";
            const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

            function readThree(n, isHighest) {
                const h = Math.floor(n / 100);
                const t = Math.floor((n % 100) / 10);
                const u = n % 10;
                const res = [];
                if (h > 0 || !isHighest) res.push(digits[h] + " trăm");
                if (t > 1) {
                    res.push(digits[t] + " mươi");
                    if (u === 1) res.push("mốt");
                    else if (u === 5) res.push("lăm");
                    else if (u > 0) res.push(digits[u]);
                } else if (t === 1) {
                    res.push("mười");
                    if (u === 5) res.push("lăm");
                    else if (u > 0) res.push(digits[u]);
                } else if (t === 0) {
                    if (u > 0) {
                        if (h > 0 || !isHighest) res.push("lẻ");
                        res.push(digits[u]);
                    }
                }
                return res.join(" ");
            }

            const units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ"];
            let n = Math.floor(amount);
            const groups = [];
            while (n > 0) {
                groups.push(n % 1000);
                n = Math.floor(n / 1000);
            }

            const parts = [];
            for (let i = groups.length - 1; i >= 0; i--) {
                const g = groups[i];
                if (g > 0) {
                    const s = readThree(g, i === groups.length - 1);
                    parts.push(s + " " + units[i]);
                }
            }

            const words = parts.join(" ").trim() + " đồng chẵn";
            return words.charAt(0).toUpperCase() + words.slice(1);
        }

function invoicePaymentDetails(o) {
            const goods=getOrderGoodsTotal(o),ship=Number(o.shippingAmount || 0);
            const vat=Number(o.vatAmount ?? (o.vat==='yes'?Math.round(goods*.08):0));
            const total=goods+vat+ship;
            const memo=('HD'+o.invoiceNo+' '+(o.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').replace(/[^a-zA-Z0-9 ]/g,'')).slice(0,25);
            const qrUrl='https://img.vietqr.io/image/vpbank-658489418-compact2.png?amount='+total+'&addInfo='+encodeURIComponent(memo)+'&accountName=HKD%20MINH%20SATORI';
            return {goods,ship,vat,total,memo,qrUrl};
        }

function invoiceVietQrPayload(o) {
            const payment=invoicePaymentDetails(o);
            const tlv=(tag,value)=>{
                const content=String(value);
                if(content.length>99)throw Error('Dữ liệu mã QR quá dài.');
                return tag+String(content.length).padStart(2,'0')+content;
            };
            const bankAccount=tlv('00','970432')+tlv('01','658489418'); // VPBank BIN + account
            const merchant=tlv('00','A000000727')+tlv('01',bankAccount)+tlv('02','QRIBFTTA');
            const amount=String(payment.total);
            if(!/^\d+$/.test(amount)||Number(amount)<=0)throw Error('Tổng tiền phải lớn hơn 0 để xuất QR thanh toán.');
            const unsealed='000201010212'+tlv('38',merchant)+'5303704'+tlv('54',amount)+'5802VN'
                +tlv('62',tlv('08',payment.memo))+'6304';
            let crc=0xffff;
            for(let i=0;i<unsealed.length;i++){
                crc^=unsealed.charCodeAt(i)<<8;
                for(let bit=0;bit<8;bit++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;
            }
            return unsealed+crc.toString(16).toUpperCase().padStart(4,'0');
        }

function invoicePdfDefinition(o, qrImage=null, logoImage=null) {
            const items=o.items?.length?o.items:[{product:o.product,unit:o.unit || 'Thùng',qty:o.qty,listPrice:o.listPrice,unitPrice:o.unitPrice}];
            if(!items.length)throw new Error('Hóa đơn chưa có mặt hàng.');
            const money=n=>Number(n || 0).toLocaleString('vi-VN')+' đ';
            const {goods,vat,ship,total,memo}=invoicePaymentDetails(o);
            const head=['STT','Tên sản phẩm','ĐVT','SL','Giá niêm yết','CK (%)','Đơn giá','Thành tiền'].map(text=>({text,bold:true,color:'#ffffff',fillColor:'#0369a1',alignment:'center',fontSize:8}));
            const rows=items.map((it,i)=>{
                const lp=Number(it.listPrice || 0),up=Number(it.unitPrice || 0),pct=it.discountPercent ?? (lp?(lp-up)/lp*100:0);
                return [String(i+1),String(it.product || ''),String(it.unit || 'Thùng'),String(it.qty),money(lp),aiDisplayPercent(pct),money(up),money(Number(it.qty)*up)].map((text,j)=>({text,alignment:j===1?'left':j>=4?'right':'center',fontSize:8}));
            });
            const bank=total>0?
                [{text:'THÔNG TIN THANH TOÁN',bold:true,color:'#0369a1',margin:[0,8,0,6]},'Ngân hàng: VPBank','Số tài khoản: 658489418','Chủ tài khoản: HKD MINH SATORI',{text:'Nội dung: '+memo,margin:[0,4,0,0]}]:
                [{text:'HÓA ĐƠN NỘI BỘ — KHÔNG CẦN THANH TOÁN',bold:true,color:'#92400e',margin:[0,8,0,6]}];
            // Paid invoices always contain an amount-specific VietQR. Zero-value bills have no payment QR.
            if(total>0)bank.push({qr:invoiceVietQrPayload(o),fit:100,foreground:'#0f172a',background:'#ffffff',margin:[0,8,0,0]});
            return {pageSize:'A4',pageMargins:[30,30,30,35],defaultStyle:{font:'Roboto',fontSize:9,color:'#0f172a'},info:{title:'Hóa đơn #'+o.invoiceNo+' - '+(o.name || ''),author:'HKD Minh Satori'},
                footer:(page,count)=>({text:page+' / '+count,alignment:'right',fontSize:8,margin:[30,8,30,0],color:'#64748b'}),
                content:[
                    {columns:[...(logoImage?[{width:62,image:logoImage,fit:[50,50],margin:[0,0,10,0]}]:[]),{width:'*',stack:[{text:'HỘ KINH DOANH MINH SATORI',bold:true,fontSize:15,color:'#0369a1'},'Mã số thuế: 075087004222','Hotline: 0903 772 980',{text:'Địa chỉ: Số 96/41 Tôn Đản, Phường Khánh Hội, TP. Hồ Chí Minh',fontSize:8}]},{width:145,alignment:'right',stack:[{text:'PHIẾU XUẤT HÓA ĐƠN',bold:true,fontSize:13},{text:'#'+o.invoiceNo,bold:true,fontSize:14,color:'#b45309'},String(o.date || ''),String(o.status || 'Chưa thanh toán')]}]},
                    {canvas:[{type:'line',x1:0,y1:0,x2:535,y2:0,lineWidth:1,lineColor:'#0284c7'}],margin:[0,12,0,12]},
                    {text:'THÔNG TIN KHÁCH HÀNG',bold:true,color:'#0369a1',margin:[0,0,0,6]},
                    {text:'Khách hàng: '+(o.name || 'Khách vãng lai')},
                    {text:'Điện thoại: '+(o.phone || '(Chưa có SĐT)')},
                    {text:'Địa chỉ giao: '+(o.location || '(Chưa có địa chỉ)')},
                    {text:'Mã số thuế: '+(o.taxCode || 'Không có'),margin:[0,0,0,12]},
                    ...(o.deliveryNote?.trim() ? [{table:{widths:['*'],body:[[{stack:[{text:'GHI CHÚ / YÊU CẦU GIAO HÀNG',bold:true,color:'#92400e',margin:[0,0,0,4]},{text:o.deliveryNote,style:'deliveryNote'}],fillColor:'#fffbeb'}]]},layout:{hLineColor:()=> '#f59e0b',vLineColor:()=> '#f59e0b'},margin:[0,0,0,12]}] : []),
                    {table:{headerRows:1,widths:[18,'*',30,24,57,38,57,64],body:[head,...rows]},layout:{hLineColor:()=> '#cbd5e1',vLineColor:()=> '#cbd5e1',paddingTop:()=>7,paddingBottom:()=>7}},
                    {columns:[{width:'*',stack:bank},{width:240,margin:[0,12,0,0],table:{widths:['*',100],body:[['Tổng tiền hàng:',{text:money(goods),alignment:'right'}],['Phí vận chuyển:',{text:money(ship),alignment:'right'}],['Thuế VAT ('+(o.vat==='yes'?'8':'0')+'%):',{text:money(vat),alignment:'right'}],[{text:'TỔNG THANH TOÁN',bold:true},{text:money(total),bold:true,alignment:'right',color:'#0369a1',fontSize:12}]]},layout:'noBorders'}]},
                    {text:'Số tiền bằng chữ: '+moneyToVietnameseWords(total),italics:true,margin:[0,12,0,16]},
                    {columns:[{stack:[{text:'ĐẠI DIỆN BÊN BÁN',bold:true},'(Ký, ghi rõ họ tên)',{text:'HKD MINH SATORI',margin:[0,45,0,0],bold:true,color:'#0369a1'}],alignment:'center'},{stack:[{text:'ĐẠI DIỆN BÊN MUA / NGƯỜI NHẬN',bold:true},'(Ký, ghi rõ họ tên)',{text:o.name || '',margin:[0,45,0,0],bold:true}],alignment:'center'}]}
                ]};
        }

function invoicePdfKey(o) {
            return JSON.stringify([o.invoiceNo,o.date,o.name,o.phone,o.location,o.deliveryNote,o.taxCode,o.status,o.items,o.product,o.qty,o.listPrice,o.unitPrice,o.vat,o.vatAmount,o.shippingAmount]);
        }


export function canonicalPdfVersion(order) {
  return invoicePdfKey(order)+'\n'+PDF_TEMPLATE_VERSION;
}
export async function renderOriginalWebsitePdf(order) {
  if(!order||typeof order!=='object'||!Number.isSafeInteger(Number(order.invoiceNo))||
    Number(order.invoiceNo)<1||!Array.isArray(order.items)||!order.items.length||
    order.items.length>40||!Number.isSafeInteger(Number(order.total))||
    Number(order.total)<0)throw Error('PDF_ORDER_INVALID');
  const goods=getOrderGoodsTotal(order);
  const total=goods+Number(order.vatAmount||0)+Number(order.shippingAmount||0);
  if(!Number.isSafeInteger(total)||total!==Number(order.total))
    throw Error('PDF_ORDER_TOTAL_MISMATCH');
  const logo=await fs.readFile(path.join(HERE,'assets','logo-satori.jpg'));
  const dataUrl='data:image/jpeg;base64,'+logo.toString('base64');
  const doc=invoicePdfDefinition(order,null,dataUrl);
  const bytes=await new Promise((resolve,reject)=>{
    const handle=setTimeout(()=>reject(Error('PDF_RENDER_TIMEOUT')),25000);
    try{pdfMake.createPdf(doc).getBuffer(x=>{clearTimeout(handle);resolve(Buffer.from(x));});}
    catch(e){clearTimeout(handle);reject(e)}
  });
  if(bytes.length<100||bytes.length>3*1024*1024||
    bytes.subarray(0,5).toString('ascii')!=='%PDF-')
    throw Error('PDF_INVALID_BYTES');
  return Object.freeze({bytes,versionKey:canonicalPdfVersion(order),
    sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
