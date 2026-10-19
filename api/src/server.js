'use strict';
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const C=require('./core');
const {poolFromEnvironment,schema,transaction}=require('./db');

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const editable=new Set(['name','phone','location','date','product','qty','items','shippingAmount','vatAmount','total','vat','discount','unitPrice']);
const RATE_WINDOW_MS=60000;
function output(res,status,result,contentType='application/json; charset=utf-8') {
  res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(contentType.startsWith('application/json')?JSON.stringify(result):result);
}
async function json(req,max=1024*1024) {
  let size=0,buf=[];
  for await(const chunk of req) {
    size+=chunk.length;if(size>max) throw C.error('BODY_TOO_LARGE','Dữ liệu gửi lên quá lớn',413);
    buf.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(buf).toString('utf8'));}
  catch {throw C.error('INVALID_JSON','JSON không hợp lệ');}
}
function scope(key,wanted) {
  if(!key.scopes?.includes(wanted) && !key.scopes?.includes('admin')) throw C.error('FORBIDDEN','Không có quyền '+wanted,403);
}
function failIfNotInitialized(initialized) {
  if(!initialized) throw C.error('NOT_INITIALIZED','API chưa được nhập dữ liệu Drive đã xác minh; không được tạo một kho dữ liệu rỗng song song',503);
}
function countLimit(raw,def=50,max=200) {
  const n=raw===null?def:Number(raw);
  if(!Number.isInteger(n)||n<1||n>max) throw C.error('INVALID_LIMIT','Giới hạn phải từ 1 đến '+max);
  return n;
}
function filters(params, {unpaid=false}={}) {
  const where=[],values=[];
  const put=(sql,value)=>{values.push(value);where.push(sql.replace('?', '$'+values.length));};
  const customer=params.get('customer');
  if(customer)put("customer_search LIKE ? ESCAPE '\\'",'%'+C.fold(customer).replace(/[%_\\]/g,'\\$&')+'%');
  const mobile=params.get('phone');
  if(mobile){const digits=C.phone(mobile);if(!digits)throw C.error('INVALID_PHONE','Số điện thoại không hợp lệ');put("phone_search LIKE ? ESCAPE '\\'",'%'+digits+'%');}
  const from=params.get('from'),to=params.get('to');
  if(from) {if(!C.dateISO(from)||! /^\d{4}-\d\d-\d\d$/.test(from)) throw C.error('INVALID_FROM','Ngày bắt đầu phải là YYYY-MM-DD');put('order_date >= ?',from);}
  if(to) {if(!C.dateISO(to)||! /^\d{4}-\d\d-\d\d$/.test(to)) throw C.error('INVALID_TO','Ngày kết thúc phải là YYYY-MM-DD');put('order_date <= ?',to);}
  if(from&&to&&from>to)throw C.error('DATE_RANGE','Khoảng ngày bị đảo');
  if(params.get('status'))put('status = ?',params.get('status'));
  if(unpaid) where.push("status NOT IN ('Đã hủy','Không Tính') AND status <> 'Đã thanh toán' AND NOT (data ? 'customerPaidAt' AND NULLIF(data->>'customerPaidAt','') IS NOT NULL)");
  return {where:where.length?' WHERE '+where.join(' AND '):'',values};
}
async function record(client,id,{lock=false}={}) {
  const result=await client.query('SELECT * FROM orders WHERE id=$1'+(lock?' FOR UPDATE':''),[id]);
  if(!result.rows.length)throw C.error('NOT_FOUND','Không thấy hóa đơn',404);
  return result.rows[0];
}
function present(row) {
  return {id:row.id,version:row.version,invoiceNo:row.invoice_no===null?null:Number(row.invoice_no),order:row.data,updatedAt:row.updated_at};
}
async function audit(client, actor, action, id, before, after) {
  await client.query('INSERT INTO audit_log(actor,action,order_id,before_state,after_state) VALUES($1,$2,$3,$4,$5)',
    [actor,action,id,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);
}
async function updateRecord(client,row,next,actor,action) {
  const cols=C.orderFields(next);
  const result=await client.query(
    'UPDATE orders SET order_date=$2,customer_search=$3,phone_search=$4,status=$5,total=$6,data=$7,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
    [row.id,cols.orderDate,cols.customerSearch,cols.phoneSearch,cols.status,cols.total,JSON.stringify(next)]);
  await audit(client,actor,action,row.id,row.data,next);
  return present(result.rows[0]);
}
function needVersion(body,current) {
  if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1) throw C.error('VERSION_REQUIRED','Cần expectedVersion lấy từ GET hóa đơn');
  if(current.version!==body.expectedVersion)throw C.error('VERSION_CONFLICT','Hóa đơn đã được thiết bị khác cập nhật. Đọc lại trước khi sửa',409);
}
function idempotencyHeader(req) {
  const key=req.headers['idempotency-key'];
  if(typeof key!=='string'||! /^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw C.error('IDEMPOTENCY_REQUIRED','Cần Idempotency-Key duy nhất, dài 8–128 ký tự');
  return key;
}
async function mutation(pool,req,actor,body,handler) {
  const idem=idempotencyHeader(req), requestHash=C.hash({method:req.method,url:req.url,body});
  return transaction(pool,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[actor+':'+idem]);
    const prev=await client.query('SELECT request_hash,response,status FROM write_receipts WHERE actor=$1 AND idem_key=$2',[actor,idem]);
    if(prev.rows.length){
      if(prev.rows[0].request_hash!==requestHash)throw C.error('IDEMPOTENCY_CONFLICT','Idempotency-Key đã dùng cho yêu cầu khác',409);
      return {status:prev.rows[0].status,payload:prev.rows[0].response};
    }
    const out=await handler(client);
    await client.query('INSERT INTO write_receipts(actor,idem_key,request_hash,response,status) VALUES($1,$2,$3,$4,$5)',
      [actor,idem,requestHash,JSON.stringify(out.payload),out.status]);
    return out;
  });
}
async function handler(req,res,pool,keys,rates) {
  const uri=new URL(req.url,'http://localhost'),p=uri.pathname;
  if(req.method==='GET' && p==='/healthz'){
    await pool.query('SELECT 1');
    return output(res,200,{ok:true,service:'minhsatori-api',version:'v1'});
  }
  if(p==='/')return output(res,200,{service:'minhsatori-api',docs:'/v1/status'});
  const key=C.authorize(req.headers.authorization,keys);
  const now=Date.now(), bucket=rates.get(key.id)||{start:now,count:0};
  if(now-bucket.start>RATE_WINDOW_MS){bucket.start=now;bucket.count=0;}
  if(++bucket.count>120)throw C.error('RATE_LIMIT','Thao tác quá nhanh',429);
  rates.set(key.id,bucket);
  const state=await pool.query('SELECT initialized,import_checksum,source_revision,imported_at FROM api_state WHERE id=1');
  const initialized=Boolean(state.rows[0]?.initialized);
  if(req.method==='GET'&&p==='/v1/status'){
    scope(key,'orders:read');
    const count=await pool.query('SELECT COUNT(*)::int AS count FROM orders');
    return output(res,200,{initialized,count:count.rows[0].count,sourceRevision:state.rows[0].source_revision,importedAt:state.rows[0].imported_at});
  }
  if(req.method==='POST'&&p==='/v1/admin/legacy/preview'){
    scope(key,'admin');
    const body=await json(req,16*1024*1024),prev=C.previewLegacy(body);
    return output(res,200,{initialized,checksum:prev.checksum,count:prev.count,invalidDates:prev.invalidDates,
      warning:'Chỉ nhập snapshot đã đối chiếu từ Google Drive. Chưa ghi dữ liệu.'});
  }
  if(req.method==='POST'&&p==='/v1/admin/legacy/import'){
    scope(key,'admin');
    const body=await json(req,16*1024*1024),prev=C.previewLegacy(body);
    if(body.checksum!==prev.checksum || body.expectedCount!==prev.count || !String(body.sourceRevision||'').trim())
      throw C.error('IMPORT_CONFIRMATION','Cần checksum, expectedCount, sourceRevision từ snapshot đã kiểm tra');
    const result=await mutation(pool,req,key.id,body,async client=>{
      const state=await client.query('SELECT initialized FROM api_state WHERE id=1 FOR UPDATE');
      if(state.rows[0].initialized)throw C.error('ALREADY_INITIALIZED','Kho dữ liệu đã nhập. Không cho ghi đè snapshot',409);
      await client.query('INSERT INTO import_backups(checksum,snapshot,source_revision,actor) VALUES($1,$2,$3,$4)',
        [prev.checksum,JSON.stringify(body.snapshot),String(body.sourceRevision),key.id]);
      for(const old of prev.orders) {
        const o=C.validateOrder(old,{legacy:true}),f=C.orderFields(o);
        await client.query('INSERT INTO orders(id,legacy_id,invoice_no,order_date,customer_search,phone_search,status,total,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [randomUUID(),String(o.id),f.invoiceNo,f.orderDate,f.customerSearch,f.phoneSearch,f.status,f.total,JSON.stringify(o)]);
      }
      await client.query('UPDATE api_state SET initialized=TRUE,import_checksum=$1,source_revision=$2,imported_at=now() WHERE id=1',
        [prev.checksum,String(body.sourceRevision)]);
      await audit(client,key.id,'legacy.import',null,null,{count:prev.count,checksum:prev.checksum,sourceRevision:String(body.sourceRevision)});
      return {status:201,payload:{imported:prev.count,checksum:prev.checksum,initialized:true}};
    });
    return output(res,result.status,result.payload);
  }
  failIfNotInitialized(initialized);
  if(req.method==='GET'&&p==='/v1/orders'){
    scope(key,'orders:read');
    const {where,values}=filters(uri.searchParams);
    const limit=countLimit(uri.searchParams.get('limit')),page=Math.max(0,Number(uri.searchParams.get('page')||0));
    if(!Number.isSafeInteger(page)||page>10000)throw C.error('INVALID_PAGE','Trang không hợp lệ');
    const rows=await pool.query('SELECT * FROM orders'+where+' ORDER BY order_date DESC NULLS LAST,invoice_no DESC NULLS LAST,id LIMIT $'+(values.length+1)+' OFFSET $'+(values.length+2),
      [...values,limit,page*limit]);
    const total=await pool.query('SELECT COUNT(*)::int AS count FROM orders'+where,values);
    return output(res,200,{count:total.rows[0].count,page,items:rows.rows.map(present)});
  }
  if(req.method==='GET'&&p==='/v1/orders/export.csv'){
    scope(key,'orders:read');
    const {where,values}=filters(uri.searchParams);
    const rows=await pool.query('SELECT * FROM orders'+where+' ORDER BY order_date DESC NULLS LAST,invoice_no DESC NULLS LAST LIMIT 10000',values);
    const headers=['ID','Hoa don','Ngay','Khach hang','SDT','Dia chi','San pham','Tong tien','Trang thai'];
    const csv='\uFEFF'+headers.map(C.safeCSV).join(',')+'\r\n'+rows.rows.map(r=>[r.id,r.invoice_no,r.data.date,r.data.name,r.data.phone,r.data.location,r.data.product||((r.data.items||[]).map(x=>x.product).join('; ')),r.total,r.status].map(C.safeCSV).join(',')).join('\r\n');
    return output(res,200,csv,'text/csv; charset=utf-8');
  }
  if(req.method==='GET'&&p==='/v1/customers'){
    scope(key,'orders:read');
    const search=uri.searchParams.get('query'),params=[],where=[];
    if(search){params.push('%'+C.fold(search).replace(/[%_\\]/g,'\\$&')+'%');where.push("customer_search LIKE $1 ESCAPE '\\'");}
    const limit=countLimit(uri.searchParams.get('limit'),50,100);params.push(limit);
    const result=await pool.query('SELECT customer_search,MAX(data->>\'name\') AS name, COUNT(*)::int AS orders, SUM(total)::text AS total FROM orders '+(where.length?'WHERE '+where.join(' AND '):'')+' GROUP BY customer_search ORDER BY name LIMIT $'+params.length,params);
    return output(res,200,{items:result.rows});
  }
  if(req.method==='GET'&&p==='/v1/debts'){
    scope(key,'orders:read');
    const {where,values}=filters(uri.searchParams,{unpaid:true});
    const agg=await pool.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(total),0)::text AS amount FROM orders'+where,values);
    const rows=await pool.query('SELECT * FROM orders'+where+' ORDER BY order_date DESC NULLS LAST,invoice_no DESC NULLS LAST LIMIT 200',values);
    return output(res,200,{count:agg.rows[0].count,total:Number(agg.rows[0].amount),items:rows.rows.map(present),truncated:agg.rows[0].count>200});
  }
  if(req.method==='GET'&&p==='/v1/audit'){
    scope(key,'admin');
    const limit=countLimit(uri.searchParams.get('limit'),50,100);
    const rows=await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT $1',[limit]);
    return output(res,200,{items:rows.rows});
  }
  const match=/^\/v1\/orders\/([0-9a-f-]+)(\/payment)?$/i.exec(p);
  if(req.method==='GET'&&match&&!match[2]){
    scope(key,'orders:read');
    if(!uuid.test(match[1]))throw C.error('INVALID_ID','ID hóa đơn không hợp lệ');
    const row=await record(pool,match[1]);
    return output(res,200,present(row));
  }
  if(req.method==='POST'&&p==='/v1/orders'){
    scope(key,'orders:write');
    const body=await json(req),o=C.validateOrder(body);
    if(C.paid(o) && !key.scopes.includes('payments:write') && !key.scopes.includes('admin')) scope(key,'payments:write');
    const out=await mutation(pool,req,key.id,body,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(71001)');
      const next=await client.query('SELECT COALESCE(MAX(invoice_no),0)+1 AS invoice_no FROM orders');
      o.invoiceNo=Number(next.rows[0].invoice_no);o.id=randomUUID();
      const f=C.orderFields(o);
      const result=await client.query('INSERT INTO orders(id,invoice_no,order_date,customer_search,phone_search,status,total,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [o.id,f.invoiceNo,f.orderDate,f.customerSearch,f.phoneSearch,f.status,f.total,JSON.stringify(o)]);
      await audit(client,key.id,'order.create',o.id,null,o);
      return {status:201,payload:present(result.rows[0])};
    });
    return output(res,out.status,out.payload);
  }
  if(req.method==='PATCH'&&match){
    if(!uuid.test(match[1]))throw C.error('INVALID_ID','ID hóa đơn không hợp lệ');
    const payment=Boolean(match[2]);
    scope(key,payment?'payments:write':'orders:write');
    const body=await json(req);
    if(!body || typeof body!=='object' || Array.isArray(body))throw C.error('INVALID_JSON','Cần một JSON object');
    const out=await mutation(pool,req,key.id,body,async client=>{
      const row=await record(client,match[1],{lock:true});needVersion(body,row);
      let o=structuredClone(row.data);
      if(payment){
        if(!['Đã thanh toán','Chưa thanh toán'].includes(body.status))throw C.error('INVALID_STATUS','Chỉ hỗ trợ đánh dấu đã/chưa thanh toán của khách');
        if(o.status==='Đã TT Satori' && !o.satoriPaidAt)o.satoriPaidAt=new Date().toISOString();
        o.status=body.status==='Chưa thanh toán' && o.satoriPaidAt?'Đã TT Satori':body.status;
        if(body.status==='Đã thanh toán')o.customerPaidAt=new Date().toISOString();
        else delete o.customerPaidAt;
      }else {
        const keys=Object.keys(body).filter(k=>k!=='expectedVersion');
        if(!keys.length||keys.some(k=>!editable.has(k)))throw C.error('INVALID_PATCH','Chỉ cho sửa các trường thông tin hóa đơn cho phép');
        const contactOnly=keys.every(k=>['name','phone','location','date'].includes(k));
        if(!contactOnly && !Array.isArray(o.items))
          throw C.error('LEGACY_PRICE_REVIEW','Hóa đơn cũ chưa có items; không tự tính lại giá, chỉ hỗ trợ sửa thông tin khách/ngày');
        for(const k of keys)o[k]=body[k];
        if(contactOnly){if(!C.fold(o.name)||!C.dateISO(o.date))throw C.error('INVALID_PATCH','Tên hoặc ngày không hợp lệ');}
        else o=C.validateOrder(o);
      }
      const changed=await updateRecord(client,row,o,key.id,payment?'payment.update':'order.update');
      return {status:200,payload:changed};
    });
    return output(res,out.status,out.payload);
  }
  throw C.error('NOT_FOUND','Đường dẫn không tồn tại',404);
}
function makeServer(pool,keys) {
  const rates=new Map();
  return http.createServer(async(req,res)=>{
    try {await handler(req,res,pool,keys,rates);}
    catch(e){const status=e.status||500;if(status===500)console.error('API internal error:',e);
      if(!res.headersSent)output(res,status,{error:{code:e.code||'INTERNAL_ERROR',message:status===500?'Lỗi máy chủ':e.message}});}
  });
}
async function start(env=process.env) {
  const raw=JSON.parse(env.SATORI_API_KEYS||'[]');
  if(!Array.isArray(raw)||!raw.length||raw.some(k=>!k.id||! /^[a-f0-9]{64}$/i.test(k.sha256||'')||!Array.isArray(k.scopes)))throw new Error('SATORI_API_KEYS needs id, sha256 and scopes; never commit plaintext API keys');
  if(new Set(raw.map(k=>k.id)).size!==raw.length)throw new Error('API key IDs must be unique');
  const pool=poolFromEnvironment(env);
  await schema(pool);
  const server=makeServer(pool,raw);
  server.listen(Number(env.PORT||3000),'0.0.0.0',()=>console.log('Minh Satori API ready (migration required before writes)'));
  const stop=()=>server.close(()=>pool.end().then(()=>process.exit(0)));
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  return server;
}
if(require.main===module)start().catch(e=>{console.error('Cannot start API:',e.message);process.exitCode=1;});
module.exports={makeServer,start,handler,filters};
