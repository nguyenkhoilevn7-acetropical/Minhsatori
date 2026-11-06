import test from 'node:test';
import assert from 'node:assert/strict';
import {groupHistoricalAddresses,normalizedDeliveryAddress,historicalInvoiceCreatedAt} from '../legacy-address-dedupe.mjs';
import {readFileSync} from 'node:fs';

const make=(count)=>Array.from({length:count},(_,i)=>({
 invoiceNo:5000+i,
 name:i%2?'New delivery recipient':'Old contact name',
 phoneCandidate:'090000000'+i,
 date:String(i+1).padStart(2,'0')+'/10/2026',
 timestamp:1790812800+i*86400,
 address:i%2?'42 Đường Số 95, Cát Lái, Hồ Chí Minh.':
  '42 DUONG SO 95 CAT LAI HO CHI MINH'
}));
for(const count of [2,3,4,7]){
 test('dedup '+count+' repeated deliveries at one address, latest source record wins',()=>{
  const group=groupHistoricalAddresses(make(count).reverse());
  assert.equal(group.length,1);
  assert.equal(group[0].invoiceNo,5000+count-1);
  assert.equal(group[0].phoneCandidate,'090000000'+(count-1));
  assert.equal(group[0].latestCreatedAt, (1790812800+(count-1)*86400)*1000);
 });
}
test('two different addresses and apartment numbers never collapse',()=>{
 const data=[
  {address:'42 Đường Số 95, Cát Lái',date:'01/10/2026',invoiceNo:1},
  {address:'42 Duong So 95 Cat Lai.',date:'02/10/2026',invoiceNo:2},
  {address:'42 Duong So 95, Cat Lai, Can 2',date:'03/10/2026',invoiceNo:3},
  {address:'43 Duong So 95 Cat Lai',date:'04/10/2026',invoiceNo:4}
 ];
 assert.equal(groupHistoricalAddresses(data).length,3);
 assert.equal(normalizedDeliveryAddress(data[0].address),normalizedDeliveryAddress(data[1].address));
});
test('source timestamp outranks invoice date and invoice number',()=>{
 const data=[
  {address:'A Real Location',invoiceNo:9500,date:'05/10/2026',timestamp:1790812800},
  {address:'a real location',invoiceNo:9400,date:'01/10/2026',timestamp:1791072000}
 ];
 assert.equal(groupHistoricalAddresses(data)[0].invoiceNo,9400);
});
test('time parser rejects invalid calendars rather than choosing a fake latest',()=>{
 assert.equal(historicalInvoiceCreatedAt({date:'31/02/2026'}),null);
 assert.equal(historicalInvoiceCreatedAt({timestamp:65,date:'03/10/2026'}),
  Date.UTC(2026,9,3));
});
test('implementation binds invoices by exact ID but writes address once per location',()=>{
 const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');
 const owner=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
 const client=readFileSync(new URL('../app.html',import.meta.url),'utf8');
 assert.match(backend,/groupHistoricalAddresses\(rows\)/);
 assert.match(backend,/normalizedDeliveryAddress\(row\.address\)/);
 assert.doesNotMatch(backend.slice(backend.indexOf('export async function ownerBindLegacyInvoices('),
  backend.indexOf('export async function linkedLegacyInvoiceHistory(')),/LEGACY_BIND_MIXED_NAMES/);
 assert.match(owner,/for\(const group of data\.addressGroups\)/);
 assert.match(owner,/invoiceNo:x\.group\.ref\.invoiceNo,sourceId:String\(x\.group\.ref\.sourceId\)/);
 assert.match(owner,/sourceRevision:source\.revision,selected:items/);
 assert.match(client,/historical\.addresses\|\|\[\]/);
});
