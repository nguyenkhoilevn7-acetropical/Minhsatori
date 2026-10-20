/* Sandbox customer identity is fixed to its link: no AI auto-approvals. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(path.join(tmpdir(),'minh-change-test-'));
const port=27000+Math.floor(Math.random()*1000),origin='http://127.0.0.1:'+port;
const secret='LOCAL_SANDBOX_ADMIN_TOKEN_DO_NOT_USE_PRODUCTION_2026';
const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:String(port),DEMO_BIND:'127.0.0.1',DEMO_DATA_DIR:dir,CUSTOMER_LINKS_ADMIN_TOKEN:secret,GEMINI_API_KEY:'',GEMINI_FREE_TIER_ONLY:'false'},stdio:['ignore','pipe','pipe']});
let diagnostics='',checks=0;proc.stdout.on('data',x=>diagnostics+=x);proc.stderr.on('data',x=>diagnostics+=x);
const check=(v,label)=>{assert.ok(v,label);checks++};
const api=async(p,method='GET',body=null,auth=false)=>{
 const resp=await fetch(origin+p,{method,headers:{...(auth?{authorization:'Bearer '+secret}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:resp.status,data:await resp.json()};
};
try{
 let live=false;
 for(let i=0;i<80;i++){try{const r=await api('/health');if(r.data.ok){live=true;break}}catch{}await new Promise(r=>setTimeout(r,60))}
 check(live,'server ready');
 check((await api('/api/admin/change-requests')).status===401,'inbox requires owner login');
 const session=await api('/api/session?token=demo-a');
 check(session.data.profile.phone==='000 000 0001','link starts with approved phone');
 const quote=await api('/api/message','POST',{token:'demo-a',message:'Cho 10 thùng Satori 5L có vòi'});
 check(!!quote.data.quote?.quoteId,'original authorized quote created');
 let changed=await api('/api/message','POST',{token:'demo-a',message:'Tôi muốn đổi số điện thoại sang 090 123 4567'});
 check(changed.data.needsHuman&&!changed.data.quote&&!!changed.data.changeRequestId,'phone change request recorded without order');
 check((await api('/api/confirm','POST',{token:'demo-a',quoteId:quote.data.quote.quoteId,requestId:'old-quote-001'})).status===409,'previous quote invalidated on change request');
 changed=await api('/api/message','POST',{token:'demo-a',message:'Giao hàng đến 789 đường Nguyễn Văn Linh thay cho địa chỉ cũ'});
 check(changed.data.needsHuman&&!changed.data.quote,'alternate delivery location blocked');
 changed=await api('/api/message','POST',{token:'demo-a',message:'Cho 5 thùng Hikari 500ml giao cho chị Lan'});
 check(changed.data.needsHuman&&!changed.data.quote,'recipient change blocks mixed order');
 const after=await api('/api/session?token=demo-a');
 check(after.data.profile.phone===session.data.profile.phone&&after.data.profile.address===session.data.profile.address,'link phone and address remain immutable');
 const inbox=await api('/api/admin/change-requests','GET',null,true);
 check(inbox.data.pendingCount===3&&inbox.data.requests.length===3,'owner inbox lists change requests');
 check(inbox.data.requests.every(x=>x.status==='pending'&&x.approvedPhone===session.data.profile.phone),'requests do not update approved phone');
 check(!JSON.stringify(inbox.data.requests).includes('demo-a'),'customer link token not stored in owner requests');
 const review=await api('/api/admin/change-requests/'+inbox.data.requests[0].id+'/review','POST',{},true);
 check(review.data.ok&&review.data.pendingCount===2,'owner marks viewed without auto-approval');
 const unchanged=await api('/api/session?token=demo-a');
 check(unchanged.data.profile.phone===session.data.profile.phone,'review does not change phone');
 check((await api('/api/admin/change-requests/'+inbox.data.requests[1].id+'/review','POST',{})).status===401,'customer cannot impersonate owner approval');
 const created=await api('/api/admin/customers','POST',{name:'Khách Demo C',phone:'000 000 0003',address:'789 Đường Mẫu, HCM',discount:20,ship:8},true);
 check(created.status===201&&created.data.customerLink.includes('/c/'),'admin creates one link for one static recipient');
 const token=created.data.customerLink.split('/c/')[1];
 const cBefore=await api('/api/session?token='+encodeURIComponent(token));
 changed=await api('/api/message','POST',{token,message:'Đổi địa chỉ qua 14 Đường Mẫu và đổi số 0912345678'});
 const cAfter=await api('/api/session?token='+encodeURIComponent(token));
 check(changed.data.needsHuman&&!changed.data.quote,'real-form private token cannot self-edit details');
 check(cAfter.data.profile.name===cBefore.data.profile.name&&cAfter.data.profile.phone===cBefore.data.profile.phone&&cAfter.data.profile.address===cBefore.data.profile.address,'private link recipient, phone, address remain unchanged');
 const records=JSON.parse(readFileSync(path.join(dir,'customer-change-requests-SANDBOX.json'),'utf8'));
 check(records.some(x=>x.profileId===cBefore.data.profile.id),'change request persisted separately from customer profile');
 const html=readFileSync(path.join(root,'admin.html'),'utf8');
 const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 check(!!source,'admin inline script exists');
 new vm.Script(source,{filename:'admin-inline.js'});checks++;
 check(html.includes('changeCount')&&html.includes('changeList'),'owner dashboard shows pending requests');
 console.log('PASS '+checks+'/'+checks+' owner notification inbox, link identity and no-auto-change checks');
}catch(e){console.error('FAILED: '+e.message);console.error(diagnostics);process.exitCode=1}
finally{proc.kill();rmSync(dir,{recursive:true,force:true})}
