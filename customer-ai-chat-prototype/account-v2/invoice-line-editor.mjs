/*
 * Owner V2 invoice lines. A typed product name, quantity, unit and price can
 * be saved without a catalogue SKU. A missing product id is left empty and is
 * never used to insert a catalogue row. Catalogue ids are accepted only when
 * they already exist. This draft is not a production Drive invoice.
 */
import crypto from 'node:crypto';
import {isUuid} from './domain.mjs';

const EVENT='V2_INVOICE_LINE_DRAFT';
const SKU=/^TP-[0-9]{5}$/;

export class InvoiceLineError extends Error{
 constructor(code,message,status=400){
  super(message);this.name='InvoiceLineError';this.code=code;this.status=status;
 }
}
const fail=(code,message,status)=>{throw new InvoiceLineError(code,message,status)};
const text=value=>typeof value==='string'?value.trim():'';
const money=value=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000;

export function normalizeInvoiceLines(input,catalogue=[]){
 if(!input||typeof input!=='object'||!Array.isArray(input.lines))
  fail('INVOICE_LINE_INVALID','Cần ít nhất một sản phẩm.');
 if(input.lines.length<1)fail('INVOICE_LINE_INVALID','Cần ít nhất một sản phẩm.');
 if(input.lines.length>40)fail('INVOICE_LINE_INVALID','Tối đa 40 sản phẩm trên một hóa đơn.');
 const known=new Map();
 for(const product of catalogue){
  if(product&&SKU.test(product.code))known.set(product.code,product);
 }
 const lines=input.lines.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
   fail('INVOICE_LINE_INVALID','Cần tên sản phẩm hợp lệ (2–180 ký tự).');
  const name=text(raw.name);
  if(name.length<2||name.length>180)
   fail('INVOICE_LINE_INVALID','Cần tên sản phẩm hợp lệ (2–180 ký tự).');
  if(!Number.isSafeInteger(raw.qty)||raw.qty<1||raw.qty>100000)
   fail('INVOICE_LINE_INVALID','Số lượng phải là số nguyên từ 1 đến 100.000.');
  const unit=text(raw.unit);
  if(unit.length<1||unit.length>40)
   fail('INVOICE_LINE_INVALID','Đơn vị không hợp lệ.');
  if(!money(raw.unitPrice))
   fail('INVOICE_LINE_INVALID','Đơn giá phải là số nguyên từ 0 đến 1.000.000.000.');
  const listed=raw.listPrice==null?raw.unitPrice:raw.listPrice;
  if(!money(listed)||listed<raw.unitPrice)
   fail('INVOICE_LINE_INVALID','Giá niêm yết phải là số nguyên không nhỏ hơn đơn giá.');
  const requested=raw.productId==null||raw.productId===''?raw.code:raw.productId;
  let productId=null;
  if(requested!=null&&requested!==''){
   productId=text(requested);
   if(!SKU.test(productId)||!known.has(productId))
    fail('INVOICE_LINE_INVALID','Mã sản phẩm không có trong danh mục.');
  }
  const lineTotal=raw.qty*raw.unitPrice;
  if(!Number.isSafeInteger(lineTotal))
   fail('INVOICE_LINE_INVALID','Thành tiền vượt giới hạn.');
  return {name,qty:raw.qty,unit,unitPrice:raw.unitPrice,listPrice:listed,
   lineTotal,productId};
 });
 const goodsVnd=lines.reduce((sum,line)=>sum+line.lineTotal,0);
 if(!Number.isSafeInteger(goodsVnd)||goodsVnd>100_000_000_000)
  fail('INVOICE_LINE_INVALID','Tổng tiền vượt giới hạn.');
 return {lines,goodsVnd,totalVnd:goodsVnd};
}

async function readDraft(db,accountId,id){
 const result=await db.query(
  'SELECT details, account_id AS "accountId" FROM satori_v2_audit '+
  'WHERE event_type=$1 AND resource_id=$2 AND account_id=$3 ORDER BY id DESC LIMIT 1',
  [EVENT,id,accountId]);
 if(!result.rows.length)return {found:false,revision:0};
 const saved=result.rows[0].details;
 if(!saved||!Number.isSafeInteger(saved.revision)||saved.revision<1||
    !Array.isArray(saved.lines))
  fail('INVOICE_DRAFT_INVALID','Bản hóa đơn đã lưu không đọc được.',500);
 return {found:true,revision:saved.revision,draft:saved};
}

export async function readInvoiceLineDraft(pool,owner,id){
 if(!isUuid(owner?.id)||!isUuid(id))
  fail('INVOICE_DRAFT_INVALID','Mã hóa đơn không hợp lệ.');
 const client=await pool.connect();
 try{
  const row=await readDraft(client,owner.id,id);
  if(!row.found)
   fail('INVOICE_DRAFT_NOT_FOUND','Không tìm thấy bản hóa đơn để mở lại.',404);
  return {ok:true,id,...row.draft};
 }finally{client.release()}
}

export async function saveInvoiceLineDraft(pool,owner,input){
 if(!isUuid(owner?.id)||!input||input.confirmed!==true)
  fail('INVOICE_DRAFT_INVALID','Cần xác nhận của chủ tài khoản trước khi lưu.',403);
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)
  fail('INVOICE_DRAFT_INVALID','Thiếu phiên bản hóa đơn để lưu.');
 const id=input.id==null?crypto.randomUUID():input.id;
 if(!isUuid(id))fail('INVOICE_DRAFT_INVALID','Mã hóa đơn không hợp lệ.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))',[20261111,id]);
  const catalogue=await client.query(
   'SELECT code, name, unit, list_price AS "listPrice" FROM satori_v2_catalogue WHERE active=true');
  const before=await readDraft(client,owner.id,id);
  if(before.revision!==input.expectedRevision)
   fail('INVOICE_DRAFT_CONFLICT','Hóa đơn đã được sửa ở nơi khác. Hãy mở lại trước khi lưu.',409);
  const normalized=normalizeInvoiceLines(input,catalogue.rows);
  const saved={revision:before.revision+1,...normalized};
  await client.query(
   'INSERT INTO satori_v2_audit(account_id,actor,event_type,resource_id,details) '+
   'VALUES($1,$2,$3,$4,$5)',
   [owner.id,'owner',EVENT,id,JSON.stringify(saved)]);
  await client.query('COMMIT');
  return {ok:true,id,...saved};
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  throw e;
 }finally{client.release()}
}
