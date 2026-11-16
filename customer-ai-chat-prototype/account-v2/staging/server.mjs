// Public synthetic playground. Never mount this entrypoint on a production service.
import http from 'node:http';
import pg from 'pg';
import {assertSyntheticEnvironment} from './guard.mjs';
import {production} from './synthetic-ledger.mjs';
import {handleGrokMcpHttp} from '../grok-mcp.mjs';
import {handleGrokFileHttp} from '../grok-ledger-read.mjs';
import {createV2CanonicalRelay} from '../canonical-ledger-relay.mjs';
import {ensureOwnerPushSchema} from '../owner-push.mjs';

assertSyntheticEnvironment(process.env);
const pool=new pg.Pool({connectionString:process.env.SATORI_V2_CI_DATABASE_URL,max:5});
await ensureOwnerPushSchema(pool);
const ledger=production();
// This known constant grants access ONLY to fake data. It is not a live credential.
const token='synthetic-only-public-fixtures-never-real-invoices-20261116';
const env={GROK_OWNER_WRITES_ENABLED:'1',GROK_OWNER_READS_ENABLED:'1',SATORI_GROK_MCP_ENABLED:'1',SATORI_GROK_MCP_TOKEN:token};
const deps={reader:ledger.reader,ownerWriteRelayFactory:ledger.rf,
 relayFactory:()=>createV2CanonicalRelay({env:ledger.writerEnv,fetcher:ledger.fetcher}),kick:()=>{}};
const banner='MINH SATORI — STAGING · HÓA ĐƠN GIẢ';
const html=`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${banner}</title>
<style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:20px;background:#f4f7fa;color:#142533}section{background:white;padding:24px;border-radius:16px;margin:16px 0}textarea{width:100%;min-height:240px;box-sizing:border-box;font:14px monospace}button,select{padding:12px;margin:8px 8px 8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}strong{color:#a24400}</style>
<h1>${banner}</h1><p><strong>Chỉ dữ liệu giả công khai. Không gửi Zalo. Khởi động lại sẽ đặt lại môi trường thử.</strong></p>
<section><h2>Thử connector V2</h2><p>Cùng mã xử lý MCP và BotApi snapshot #430; PostgreSQL cục bộ tạm thời. Không kết nối sổ thật.</p><select id="example"></select><button id="load">Điền ví dụ</button><textarea id="input" aria-label="Yêu cầu JSON-RPC"></textarea><button id="send">Chạy yêu cầu thử</button><p>Với thao tác ghi: đọc summary trước, rồi tự chọn tool confirm và nhập requestId/draftId. Không tự xác nhận.</p><pre id="output"></pre></section>
<section><h2>Phạm vi kiểm thử</h2><p>Tạo/tìm/đọc đơn; sửa/hoàn tác; thanh toán hai chiều; công nợ; PDF; Thùng Rác; lịch sử. Hàng đợi PDF có test PostgreSQL riêng; nút thử không gửi Zalo.</p><p>OAuth GitLab không chạy trên môi trường này. Tính đúng phiên bản Apps Script đang deploy và quyền thật vẫn cần kiểm tra trước production.</p></section>
<script>
const examples={
 'Danh sách tool':{method:'tools/list'},
 'Đọc bill giả 501':{method:'tools/call',params:{name:'satori_order_get',arguments:{invoiceNo:501,id:'L501'}}},
 'Đánh dấu thanh toán — chỉ request':{method:'tools/call',params:{name:'satori_order_mark_paid_request',arguments:{invoiceNo:503,id:'L503',expectedName:'Khách Thanh Toán Giả',expectedTotal:120000,customerPaid:true,satoriPaid:true,proofNote:'Giao dịch giả STAGING-20261116'}}},
 'Confirm thanh toán — nhập requestId':{method:'tools/call',params:{name:'satori_order_mark_paid_confirm',arguments:{requestId:'NHAP_REQUEST_ID'}}},
 'Tạo đơn — chỉ draft':{method:'tools/call',params:{name:'satori_order_draft',arguments:{newCustomer:true,customer:{name:'Khách Staging Giả',phone:'0900000999',location:'01 Đường Giả'},items:[{product:'Nước Giả',qty:2,unitPrice:100000}],vatRate:8}}},
 'Confirm tạo đơn — nhập draftId':{method:'tools/call',params:{name:'satori_order_confirm',arguments:{draftId:'NHAP_DRAFT_ID'}}}
};
const select=document.querySelector('#example'),input=document.querySelector('#input'),output=document.querySelector('#output');
for(const name of Object.keys(examples)){const o=document.createElement('option');o.textContent=name;select.append(o)}
document.querySelector('#load').onclick=()=>input.value=JSON.stringify({jsonrpc:'2.0',id:1,...examples[select.value]},null,2);
document.querySelector('#load').click();
document.querySelector('#send').onclick=async()=>{try{const body=JSON.parse(input.value);output.textContent='Đang chạy…';const r=await fetch('/mcp/grok/${token}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});output.textContent=JSON.stringify(await r.json(),null,2)}catch{output.textContent='Yêu cầu không hợp lệ hoặc máy chủ tạm lỗi'}};
</script></html>`;
let chain=Promise.resolve(); // GAS fixture reader temporarily sets fetch; serialize fixture access.
const server=http.createServer((req,res)=>{
 chain=chain.then(async()=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&pathname==='/'){
   res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(html);return;
  }
  if(req.method==='GET'&&pathname==='/healthz'){
   await pool.query('SELECT 1');res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify({ok:true,syntheticOnly:true,officialLedgerConnected:false,zaloSender:false}));return;
  }
  if(await handleGrokFileHttp(req,res,pathname,{...deps,env,pool}))return;
  if(await handleGrokMcpHttp(req,res,pathname,async()=>pool,env,deps))return;
  res.writeHead(404);res.end();
 }).catch(()=>{if(!res.headersSent)res.writeHead(503);res.end('SYNTHETIC_STAGING_ERROR')});
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||10000),'0.0.0.0');
process.on('SIGTERM',()=>server.close(()=>pool.end().then(()=>process.exit(0))));
