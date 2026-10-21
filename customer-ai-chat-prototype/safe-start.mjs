/**
 * Sandbox-only fail-closed supervisor.
 * Run the existing server unchanged; if its integrity/staleness guard refuses
 * the encrypted bootstrap, keep Render reachable in a read-only maintenance
 * state. NEVER skip the guard, replace backups, or reinitialize customer data.
 */
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.DEMO_BIND||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
let maintenance=null;
let terminating=false;

function startMaintenance(){
 if(maintenance||terminating)return;
 const page='<!doctype html><html lang="vi"><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Minh Satori - Bảo trì bản thử</title>'+
  '<style>body{font:16px system-ui,sans-serif;line-height:1.6;background:#f5f8fc;'+
  'color:#173651;max-width:680px;margin:12vh auto;padding:24px}main{background:white;'+
  'padding:28px;border:1px solid #dbe5f0;border-radius:18px}h1{font-size:23px}</style>'+
  '<main><h1>Minh Satori đang bảo trì bản thử</h1>'+
  '<p>Bản sao dữ liệu thử cần được xác minh trước khi hệ thống tiếp tục hoạt động.'+
  ' Trang quản trị, chat đặt hàng và thao tác ghi hiện đều tạm khóa.</p>'+
  '<p>Quản trị viên đang kiểm tra việc khôi phục an toàn. Xin vui lòng thử lại sau.</p>'+
  '</main></html>';
 maintenance=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Retry-After','120');
  if(req.method==='GET'&&(req.url==='/health'||req.url==='/api/recovery-status')){
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',
    'Content-Security-Policy':"default-src 'none'"});
   return res.end(JSON.stringify({
    ok:req.url==='/health',sandbox:true,ready:false,maintenance:true,
    code:'BOOTSTRAP_RECOVERY_REQUIRED'
   }));
  }
  if(req.method==='GET'&&(req.url==='/'||req.url==='/admin'||/^\/c\/(?:demo-[ab]|[A-Za-z0-9_-]{40,96})$/.test(req.url||''))){
   res.writeHead(503,{'Content-Type':'text/html; charset=utf-8',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
   return res.end(page);
  }
  res.writeHead(503,{'Content-Type':'application/json; charset=utf-8',
   'Content-Security-Policy':"default-src 'none'"});
  return res.end(JSON.stringify({ok:false,sandbox:true,maintenance:true,
   error:'BOOTSTRAP_RECOVERY_REQUIRED',
   message:'Bản thử đang bảo trì an toàn; không nhận thao tác thay đổi dữ liệu.'}));
 });
 maintenance.on('error',()=>{console.error('SANDBOX_MAINTENANCE_PORT_FAILED');process.exitCode=78});
 maintenance.listen(PORT,HOST,()=>console.warn('SANDBOX_MAINTENANCE_LISTENING - writes disabled'));
}

const child=spawn(process.execPath,[path.join(HERE,'server.mjs')],{
 cwd:HERE,env:process.env,stdio:'inherit'
});
child.on('error',()=>{
 console.error('SANDBOX_CHILD_START_FAILED');
 startMaintenance();
});
child.on('exit',(code)=>{
 if(terminating)return;
 console.error('SANDBOX_CHILD_UNAVAILABLE',Number.isInteger(code)?code:'signal');
 startMaintenance();
});
for(const signal of ['SIGTERM','SIGINT']){
 process.on(signal,()=>{
  terminating=true;
  if(child.exitCode===null)child.kill(signal);
  if(maintenance)maintenance.close();
  setTimeout(()=>process.exit(0),1000).unref();
 });
}
