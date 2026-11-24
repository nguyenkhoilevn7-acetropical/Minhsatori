/**
 * Debt statement PDF (bảng kê công nợ) for the Grok owner connector.
 * Read-only: rendered in memory from rows already computed from the signed
 * ledger; never stored, never logged. Uses the same pdfmake + Roboto VFS as the
 * official invoice PDF (Vietnamese glyphs), loaded lazily on first render.
 */
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const vnd=n=>Number(n).toLocaleString('vi-VN')+' đ';
const viDate=iso=>/^\d{4}-\d{2}-\d{2}$/.test(String(iso||''))?iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4):String(iso||'');
const clip=(v,n)=>String(v==null?'':v).replace(/[\u0000-\u001f]/g,' ').slice(0,n);

/** Pure pdfmake document definition (unit-testable without pdfmake). */
export function debtStatementDefinition(st){
 const perCustomer=!!st.customerName;
 const head=['Số HĐ','Ngày',...(perCustomer?[]:['Khách']),'Tổng','Đã trả','Còn nợ','Cộng dồn nợ'];
 const body=[head.map(text=>({text,bold:true,fillColor:'#e2e8f0'}))];
 for(const r of st.rows){
  body.push([String(r.invoiceNo),viDate(r.date),...(perCustomer?[]:[clip(r.name,60)]),
   {text:vnd(r.total),alignment:'right'},{text:vnd(r.paid),alignment:'right'},
   {text:vnd(r.owed),alignment:'right'},{text:vnd(r.cumulative),alignment:'right'}]);
 }
 body.push([{text:'TỔNG CỘNG',bold:true,colSpan:perCustomer?2:3},'',...(perCustomer?[]:['']),
  {text:vnd(st.totals.total),bold:true,alignment:'right'},{text:vnd(st.totals.paid),bold:true,alignment:'right'},
  {text:vnd(st.totals.owed),bold:true,alignment:'right'},'']);
 return {
  pageSize:'A4',pageMargins:[28,32,28,36],defaultStyle:{font:'Roboto',fontSize:9},
  info:{title:'Bang ke cong no Minh Satori',creator:'Minh Satori'},
  content:[
   {text:'MINH SATORI',bold:true,fontSize:14,color:'#0f172a'},
   {text:'BẢNG KÊ CÔNG NỢ',bold:true,fontSize:16,alignment:'center',margin:[0,8,0,4]},
   {text:(perCustomer?'Khách: '+clip(st.customerName,150):'Tất cả khách còn nợ'),alignment:'center'},
   {text:'Từ '+viDate(st.from)+' đến '+viDate(st.to)+(st.days?' ('+st.days+' ngày)':''),alignment:'center',margin:[0,0,0,10]},
   {table:{headerRows:1,widths:perCustomer?[50,62,'*','*','*','*']:[44,56,'*',70,62,70,74],body},
    layout:'lightHorizontalLines'},
   {text:'Còn nợ: '+vnd(st.totals.owed),bold:true,fontSize:12,margin:[0,10,0,4],alignment:'right'},
   ...(st.notes||[]).map(t=>({text:'• '+clip(t,300),italics:true,color:'#475569',margin:[0,2,0,0]})),
   {text:'Lập lúc '+clip(st.generatedAt,40)+' từ sổ Minh Satori (chỉ đọc). Hóa đơn đã hủy/không tính không có trong công nợ.',
    fontSize:8,color:'#64748b',margin:[0,12,0,0]}
  ]
 };
}

let pdfMake=null;
function loadPdfMake(){
 if(pdfMake)return pdfMake;
 const require=createRequire(import.meta.url);
 const pm=require('pdfmake/build/pdfmake.js');
 const fm=require('pdfmake/build/vfs_fonts.js');
 const vfs=fm.pdfMake?.vfs||fm.vfs||fm;
 if(!vfs['Roboto-Regular.ttf'])throw Error('PDF_ROBOTO_VFS_MISSING');
 pm.vfs=vfs;pdfMake=pm;return pm;
}

/** Returns {bytes, sha256}. Throws on any invalid output. */
export async function renderDebtStatementPdf(st,{pdf=loadPdfMake}={}){
 if(!st||!Array.isArray(st.rows)||st.rows.length>500||!st.totals)throw Error('DEBT_PDF_INPUT_INVALID');
 const pm=pdf();
 const bytes=await new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(Error('DEBT_PDF_TIMEOUT')),25000);
  try{pm.createPdf(debtStatementDefinition(st)).getBuffer(x=>{clearTimeout(t);resolve(Buffer.from(x))})}
  catch(e){clearTimeout(t);reject(e)}
 });
 if(bytes.length<100||bytes.length>8*1024*1024||bytes.subarray(0,5).toString('ascii')!=='%PDF-')
  throw Error('DEBT_PDF_INVALID_BYTES');
 return {bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),stub:!!pm.__localStub};
}
