import test from 'node:test';
import assert from 'node:assert/strict';
import {createCachedStorageProbe,inspectV2Storage,V2_REQUIRED_COLUMNS} from '../db-readiness.mjs';
const rows=()=>Object.entries(V2_REQUIRED_COLUMNS).flatMap(([tableName,columns])=>
 columns.map(columnName=>({tableName,columnName})));
test('read-only schema probe verifies 20 expected V2-only tables and columns',async()=>{
 const queries=[];
 const result=await inspectV2Storage({query:async(sql,params)=>{
  queries.push({sql,params});return {rows:rows()};
 }});
 assert.deepEqual(result,{connected:true,schemaReady:true,tableCount:20});
 assert.equal(queries.length,1);
 assert.match(queries[0].sql,/information_schema\.tables/);
 assert.doesNotMatch(queries[0].sql,/SELECT\s+\*/i);
 assert.equal(queries[0].params[0].length,20);
});
test('missing CRM migration column is NOT declared ready',async()=>{
 const filtered=rows().filter(x=>!(
  x.tableName==='satori_v2_accounts'&&x.columnName==='access_status'));
 const result=await inspectV2Storage({query:async()=>({rows:filtered})});
 assert.equal(result.connected,true);
 assert.equal(result.schemaReady,false);
 assert.equal(result.tableCount,20);
});
test('missing CRM table is NOT declared ready',async()=>{
 const filtered=rows().filter(x=>x.tableName!=='satori_v2_customer_leads');
 const result=await inspectV2Storage({query:async()=>({rows:filtered})});
 assert.equal(result.schemaReady,false);
 assert.equal(result.tableCount,19);
});
test('concurrent public readiness requests collapse to one read and cache result',async()=>{
 let t=1000,calls=0;
 const cached=createCachedStorageProbe(async()=>{
  calls++;await Promise.resolve();
  return {connected:true,schemaReady:true,tableCount:20};
 },()=>t,30000);
 const all=await Promise.all(Array.from({length:100},()=>cached()));
 assert.equal(calls,1);
 assert.ok(all.every(x=>x.schemaReady===true));
 t+=29999;await cached();assert.equal(calls,1);
 t+=2;await cached();assert.equal(calls,2);
});
test('invalid connection fails closed without leaking the database error',async()=>{
 const cached=createCachedStorageProbe(async()=>{throw Error(
  'password=secret DATABASE_URL=postgresql://sensitive')});
 const result=await cached();
 assert.deepEqual(result,{connected:false,schemaReady:false,tableCount:0});
 assert.doesNotMatch(JSON.stringify(result),/postgres|secret/i);
});
