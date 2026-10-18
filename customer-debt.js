/* Customer-facing receivables. Never exports the internal accounting workbook. */
(function(root){
'use strict';
const C=root.SatoriAccountingCore;
const moneyFormat='#,##0;[Red](#,##0);"–"';
const formula=(formula,result)=>({formula,result});
const fill=color=>({type:'pattern',pattern:'solid',fgColor:{argb:'FF'+color}});
function dateValue(value){
 const s=String(value||''),m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)||s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(!m)return s;
 const iso=m[1].length===4,y=+(iso?m[1]:m[3]),month=+m[2],day=+(iso?m[3]:m[1]),d=new Date(Date.UTC(y,month-1,day));
 return d.getUTCFullYear()===y&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?d:s;
}
function prepare(data){
 const model=C.calculate(data.allOrders||data.orders,[]),byId=new Map(model.rows.map(r=>[C.key(r.order),r]));
 const excluded=[],rows=[],seen=new Set();
 for(const o of data.orders){
  const key=C.key(o);if(seen.has(key))continue;seen.add(key);
  const r=byId.get(key);
  if(!C.active(o)||r?.secondary){excluded.push({invoice:String(o.invoiceNo??''),reason:!C.active(o)?'Hủy / không tính':'Bill đối chiếu CTV'});continue;}
  if(o.total===null||o.total===''||(o.total!==undefined&&!Number.isFinite(Number(o.total)))||!Number.isFinite(C.total(o))||C.total(o)<0)throw Error('Hóa đơn '+(o.invoiceNo??'')+' thiếu hoặc sai tổng tiền. Kiểm tra trước khi xuất công nợ.');
  const amount=C.total(o),paid=C.paid(o)?amount:0;
  rows.push({order:o,amount,paid,due:amount-paid,review:!!r?.review});
 }
 return {rows,excluded,total:rows.reduce((s,r)=>s+r.amount,0),paid:rows.reduce((s,r)=>s+r.paid,0),due:rows.reduce((s,r)=>s+r.due,0),review:rows.filter(r=>r.review).length};
}
async function build(data,Excel){
 const p=prepare(data);if(!p.rows.length)throw Error('Không có hóa đơn bán khách hợp lệ trong bộ lọc này.');
 const wb=new Excel.Workbook();wb.creator='Minh Satori';wb.created=new Date();wb.calcProperties={fullCalcOnLoad:true,forceFullCalc:true};
 const ws=wb.addWorksheet('Cong no khach',{properties:{tabColor:{argb:'FF075985'}},views:[{state:'frozen',xSplit:3,ySplit:12,showGridLines:false}],pageSetup:{orientation:'landscape',paperSize:8,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'12:12',margins:{left:.25,right:.25,top:.4,bottom:.4,header:.15,footer:.15}}});
 const widths=[6,14,13,28,36,34,20,20,20,23,14,29];widths.forEach((w,i)=>ws.getColumn(i+1).width=w);
 function line(row,text,height=26){ws.mergeCells(row,1,row,12);const c=ws.getCell(row,1);c.value=text;c.alignment={vertical:'middle',wrapText:true};ws.getRow(row).height=height;}
 line(2,'MINH SATORI — BẢNG ĐỐI CHIẾU CÔNG NỢ KHÁCH HÀNG',30);ws.getCell('A2').font={name:'Arial',size:16,bold:true,color:{argb:'FF075985'}};
 line(3,'Khách / từ khóa: '+(data.customer||'Tất cả khách trong bộ lọc')+' · Từ '+(data.from||'đầu kỳ')+' đến '+(data.to||'hiện tại'));
 line(4,'Bộ lọc: '+(data.scope||'Sổ kế toán')+' · Xuất lúc '+new Date().toLocaleString('vi-VN')+' · Đơn vị: VND',30);
 line(5,'Còn nợ = Tổng hóa đơn − Khách đã trả (tối thiểu 0). Cột H nền vàng có thể nhập số tiền đã trả thực tế trong Excel.');
 line(6,'Đã trả lấy theo ghi nhận thanh toán của khách trên hệ thống. Trả Satori không giảm nợ khách. File chỉ tính các bill theo bộ lọc, không gồm dư nợ đầu kỳ.',30);
 line(7,p.excluded.length?'Đã bỏ qua '+p.excluded.length+' bill: '+p.excluded.map(r=>'#'+r.invoice+' ('+r.reason+')').join(', '):'Nguồn: Hóa đơn bán khách trong Sổ kế toán Minh Satori.');
 if(p.excluded.length)ws.getRow(7).height=Math.max(30,Math.ceil(ws.getCell('A7').value.length/180)*15+10);
 line(8,p.review?p.review+' bill có nhóm cùng người nhận / giỏ hàng cần đối chiếu lại trước khi yêu cầu thanh toán. Xem cột Ghi chú.':'Phạm vi: '+p.rows.length+' hóa đơn. Cột còn nợ và trạng thái tự cập nhật khi thay đổi số tiền khách đã trả.');
 ws.getCell('F9').value='TỔNG CỘNG';ws.getCell('G9').value='Tổng hóa đơn';ws.getCell('H9').value='Khách đã trả';ws.getCell('I9').value='Còn phải thu';
 const start=13,end=start+p.rows.length-1;
 for(const [col,result] of [['G',p.total],['H',p.paid],['I',p.due]])ws.getCell(col+'10').value=formula('SUM('+col+start+':'+col+end+')',result);
 const headers=['STT','Số hóa đơn','Ngày hóa đơn','Khách hàng / Mã / SĐT','Địa chỉ nhận hàng','Sản phẩm / Số lượng','Tổng hóa đơn (đ)','Khách đã trả (đ)','Còn nợ (đ)','Trạng thái khách','Ngày ghi TT','Ghi chú'];
 ws.getRow(12).values=headers;ws.getRow(12).height=36;
 p.rows.forEach((entry,i)=>{
  const {order:o,amount,paid,due,review}=entry,r=start+i,date=dateValue(o.date);
  const customer=[o.name,o.customerCode||o.customerId||o.clientCode,o.phone].filter(Boolean).join('\n');
  const goods=C.items(o).map(item=>[item.product||item.name||item.code||'Sản phẩm',String(item.qty??'')+' '+(item.unit||'Thùng')].join(' — ')).join('\n');
  const paidDate=o.customerPaidAt?dateValue(String(o.customerPaidAt).slice(0,10)):'';
  ws.getRow(r).values=[i+1,String(o.invoiceNo??o.id??''),date,customer,o.location||null,goods,amount,paid,formula('MAX(0,G'+r+'-H'+r+')',due),formula('IF(OR(NOT(ISNUMBER(H'+r+')),H'+r+'<0,H'+r+'>G'+r+'),"Kiểm tra tiền trả",IF(I'+r+'>0,"Còn nợ","Đã thanh toán"))',due?'Còn nợ':'Đã thanh toán'),paidDate||null,[review?'Cần đối chiếu nhóm cùng người nhận / hàng.':'',typeof date==='string'?'Kiểm tra ngày hóa đơn.':''].filter(Boolean).join(' ')||null];
  let lines=1;ws.getRow(r).eachCell((cell,col)=>{const text=cell.value instanceof Date?'':String(cell.value?.result??cell.value??'');lines=Math.max(lines,...text.split('\n').map(s=>Math.ceil(s.length/Math.max(5,widths[col-1]-3))));});ws.getRow(r).height=Math.max(42,lines*15+10);
  ws.getCell('H'+r).dataValidation={type:'decimal',operator:'between',allowBlank:false,formulae:[0,'G'+r],showErrorMessage:true,errorTitle:'Số tiền chưa hợp lệ',error:'Nhập số từ 0 đến tổng hóa đơn.'};
 });
 ws.eachRow((row,n)=>row.eachCell({includeEmpty:true},(cell,col)=>{
  if(n!==2)cell.font={name:'Arial',size:11,color:{argb:'FF1E293B'}};
  cell.alignment={vertical:'middle',wrapText:true,horizontal:col>=7&&col<=9?'right':'left'};
  if(n>=start){cell.fill=fill(n%2?'F1F5F9':'FFFFFF');cell.border={bottom:{style:'hair',color:{argb:'FFE2E8F0'}}};if(col===8){cell.fill=fill('FEF3C7');cell.font={name:'Arial',size:11,color:{argb:'FF1D4ED8'}};}if(col===10)cell.alignment={vertical:'middle',wrapText:true,indent:1};if(col===9)cell.font={name:'Arial',size:11,bold:true,color:{argb:'FF111827'}};}
  if(n===12){cell.fill=fill('075985');cell.font={name:'Arial',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};}
  if(n===9&&col>=6&&col<=9){cell.font={name:'Arial',size:11,bold:true,color:{argb:'FF475569'}};}
  if(n===10&&col>=7&&col<=9){cell.fill=fill(col===9?'FFEDD5':'E0F2FE');cell.font={name:'Arial',size:14,bold:true,color:{argb:col===9?'FF9A3412':'FF075985'}};cell.numFmt=moneyFormat;}
 }));
 ws.getRow(10).height=30;
 for(let r=start;r<=end;r++){for(const col of ['G','H','I'])ws.getCell(col+r).numFmt=moneyFormat;for(const col of ['C','K'])ws.getCell(col+r).numFmt='dd/mm/yyyy';ws.getCell('B'+r).numFmt='@';}
 ws.addConditionalFormatting({ref:'I'+start+':J'+end,rules:[{type:'expression',priority:2,formulae:['$I'+start+'>0'],style:{fill:fill('FFF1F2'),font:{color:{argb:'FFBE123C'},bold:true}}},{type:'expression',priority:3,formulae:['$I'+start+'=0'],style:{fill:fill('DCFCE7'),font:{color:{argb:'FF166534'}}}}]});
 ws.addConditionalFormatting({ref:'H'+start+':J'+end,rules:[{type:'expression',priority:1,formulae:['OR(NOT(ISNUMBER($H'+start+')),$H'+start+'<0,$H'+start+'>$G'+start+')'],style:{fill:fill('FEE2E2'),font:{color:{argb:'FFB91C1C'},bold:true}}}]});
 ws.autoFilter={from:{row:12,column:1},to:{row:end,column:12}};ws.pageSetup.printArea='A1:L'+end;ws.headerFooter.oddFooter='Minh Satori · Công nợ theo bộ lọc · Trang &P / &N';
 return wb;
}
function filename(data){const name=C.norm(data.customer||'khach-hang').replace(/[^a-z0-9]+/g,'-').slice(0,65)||'khach-hang';return 'Cong-no-'+name+'-'+(data.from||'dau-ky')+'_'+(data.to||new Date().toISOString().slice(0,10))+'.xlsx';}
async function download(data){const Excel=await root.SatoriWorkbook.library(),wb=await build(data,Excel),buffer=await wb.xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=filename(data);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
root.SatoriCustomerDebt={prepare,build,download,filename};
})(typeof window!=='undefined'?window:globalThis);
