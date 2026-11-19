import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLegacyInvoiceRefs,linkedLegacyInvoiceHistory} from '../customer-backend.mjs';

// Synthetic reproduction of the observed shape: duplicate bill numbers,
// distinct IDs and contacts; never production customer data.
const rows=[
 {invoiceNo:85,id:1792100000000,name:'Synthetic A',location:'10 Test Road',date:'10/10/2026'},
 {invoiceNo:85,id:1792100000009,name:'Synthetic B',location:'20 Test Road',date:'10/10/2026'},
 {invoiceNo:5960,id:1793270028008,name:'Synthetic A',location:'10 Test Road',date:'29/10/2026'},
 {invoiceNo:5,id:123456,name:'Synthetic C',location:'30 Test Road',date:'29/10/2026'}
];
const ref=row=>({invoiceNo:row.invoiceNo,sourceId:String(row.id)});

test('signed source resolver and history use exact composite identity',async t=>{
 const oldFetch=globalThis.fetch;
 const keys=['SATORI_READ_ENDPOINT','SATORI_READ_KEY_ID','SATORI_READ_HMAC_SECRET'];
 const old=keys.map(k=>process.env[k]);
 Object.assign(process.env,{SATORI_READ_ENDPOINT:'https://script.google.com/macros/s/fake-only/exec',
  SATORI_READ_KEY_ID:'fake_read',SATORI_READ_HMAC_SECRET:'x'.repeat(40)});
 let revision=42,source=rows,total=null;
 const queries=[];
 globalThis.fetch=async(_url,options)=>{
  const req=JSON.parse(options.body);assert.equal(req.action,'orders.list');
  queries.push(req.payload.query);
  const matches=source.filter(o=>String(o.invoiceNo).includes(req.payload.query)||o.name.includes(req.payload.query));
  return new Response(JSON.stringify({ok:true,action:req.action,revision,
   data:{orders:matches,totalMatches:total??matches.length}}));
 };
 try{
  await t.test('duplicate number 85 resolves only selected ID; 5960 remains separate',async()=>{
   const out=await resolveLegacyInvoiceRefs([ref(rows[1]),ref(rows[2])],42);
   assert.deepEqual(out.orders.map(o=>o.id),[String(rows[1].id),String(rows[2].id)]);
   assert.deepEqual(queries,['85','5960']);
  });
  await t.test('wrong source ID cannot fall back to same invoice number',async()=>{
   await assert.rejects(resolveLegacyInvoiceRefs([{invoiceNo:85,sourceId:'wrong'}],42),
    /LEGACY_BIND_SOURCE_REF_NOT_FOUND/);
  });
  await t.test('changed source revision fails closed',async()=>{
   revision=43;
   await assert.rejects(resolveLegacyInvoiceRefs([ref(rows[0])],42),/LEGACY_SOURCE_REVISION_CHANGED/);
   revision=42;
  });
  await t.test('duplicate composite identity is ambiguous, never silently overwritten',async()=>{
   source=[...rows,rows[0]];
   await assert.rejects(resolveLegacyInvoiceRefs([ref(rows[0])],42),/LEGACY_BIND_SOURCE_REF_AMBIGUOUS/);
   source=rows;
  });
  await t.test('truncated source cannot prove identity',async()=>{
   total=101;
   await assert.rejects(resolveLegacyInvoiceRefs([ref(rows[0])],42),/LEGACY_BIND_RESULT_TRUNCATED/);
   total=null;
  });
  await t.test('single digit historical invoice number is supported',async()=>{
   assert.equal((await resolveLegacyInvoiceRefs([ref(rows[3])],42)).orders[0].invoiceNo,5);
  });
  await t.test('history survives renamed source contact without disclosing other bill 85',async()=>{
   const pool={query:async()=>({rowCount:1,rows:[{details:{...ref(rows[1]),query:'Old removed name'}}]})};
   const out=await linkedLegacyInvoiceHistory(pool,{id:'synthetic-account'});
   assert.equal(out.orders.length,1);assert.equal(out.unavailableCount,0);
   assert.equal(out.orders[0].sourceId,String(rows[1].id));
  });
 }finally{
  globalThis.fetch=oldFetch;
  keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i]});
 }
});
