'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const C=require('../src/core');
const {schema}=require('../src/db');
const {makeServer}=require('../src/server');

test('Postgres API: import, no data loss, invoice and payment concurrency', {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const tokens={admin:'admin_'+'a'.repeat(50),read:'read_'+'b'.repeat(50),write:'write_'+'c'.repeat(50),pay:'pay_'+'d'.repeat(50)};
  const keys=[
    {id:'admin',sha256:C.hash(tokens.admin),scopes:['admin']},
    {id:'read',sha256:C.hash(tokens.read),scopes:['orders:read']},
    {id:'writer',sha256:C.hash(tokens.write),scopes:['orders:read','orders:write']},
    {id:'pay',sha256:C.hash(tokens.pay),scopes:['orders:read','payments:write']}
  ];
  await schema(pool);
  const server=makeServer(pool,keys);
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const url='http://127.0.0.1:'+server.address().port;
  const req=async(path,method='GET',token='admin',body,idem)=>{
    const headers={Authorization:'Bearer '+tokens[token]};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(idem)headers['Idempotency-Key']=idem;
    const response=await fetch(url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const contentType=response.headers.get('content-type')||'';
    return {status:response.status,body:contentType.includes('json')?await response.json():await response.text()};
  };
  try{
    assert.equal((await req('/v1/status')).body.initialized,false);
    assert.equal((await req('/v1/orders')).status,503);
    assert.equal((await req('/v1/admin/legacy/preview','POST','read',{})).status,403);
    const snapshot={values:{satori_orders_v15:JSON.stringify([
      {id:1,invoiceNo:1,date:'19/10/2026',name:'Khách cũ',phone:'0900111222',location:'VN',product:'Satori 350ml',qty:1,unitPrice:12000,total:12000,status:'Chưa thanh toán'}])}};
    const preview=await req('/v1/admin/legacy/preview','POST','admin',{snapshot});
    assert.equal(preview.status,200);
    assert.equal(preview.body.count,1);
    const imp={snapshot,checksum:preview.body.checksum,expectedCount:1,sourceRevision:'tested-drive-revision'};
    const imported=await req('/v1/admin/legacy/import','POST','admin',imp,'import-test-001');
    assert.equal(imported.status,201);
    assert.equal((await req('/v1/status')).body.count,1);
    assert.equal((await req('/v1/admin/legacy/import','POST','admin',imp,'import-test-002')).status,409);
    const data={date:'2026-10-19',name:'Khách mới',phone:'0900333444',location:'Thủ Đức',
      items:[{code:'TP-00001',product:'Satori 350ml',qty:2,unitPrice:65000}],status:'Chưa thanh toán'};
    assert.equal((await req('/v1/orders','POST','read',data,'create-test-001')).status,403);
    const newOrder=await req('/v1/orders','POST','write',data,'create-test-002');
    assert.equal(newOrder.status,201);
    assert.equal(newOrder.body.order.total,130000);
    assert.equal(newOrder.body.invoiceNo,2);
    const repeated=await req('/v1/orders','POST','write',data,'create-test-002');
    assert.equal(repeated.status,201);
    assert.equal(repeated.body.id,newOrder.body.id);
    assert.equal((await req('/v1/status')).body.count,2);
    const debt=await req('/v1/debts?from=2026-10-01&to=2026-10-31','GET','read');
    assert.equal(debt.status,200);assert.equal(debt.body.count,2);assert.equal(debt.body.total,142000);
    const patch={expectedVersion:1,status:'Đã thanh toán'};
    assert.equal((await req('/v1/orders/'+newOrder.body.id+'/payment','PATCH','write',patch,'pay-test-001')).status,403);
    const paid=await req('/v1/orders/'+newOrder.body.id+'/payment','PATCH','pay',patch,'pay-test-002');
    assert.equal(paid.status,200);assert.equal(paid.body.version,2);
    assert.equal((await req('/v1/orders/'+newOrder.body.id+'/payment','PATCH','pay',patch,'pay-test-003')).status,409);
    assert.equal((await req('/v1/debts','GET','read')).body.total,12000);
    assert.equal((await req('/v1/orders/'+newOrder.body.id,'GET','read')).body.order.status,'Đã thanh toán');
    const csv=await req('/v1/orders/export.csv','GET','read');
    assert.equal(csv.status,200);assert.ok(csv.body.includes('Khách mới'));
    const audit=await req('/v1/audit','GET','admin');
    assert.equal(audit.status,200);assert.ok(audit.body.items.length>=3);
    assert.equal((await req('/v1/audit','GET','read')).status,403);
  }finally{
    await new Promise(ok=>server.close(ok));
    await pool.end();
  }
});
