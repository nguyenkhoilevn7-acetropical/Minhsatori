import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateCustomerProfile} from '../customer-management.mjs';
import {groupHistoricalAddresses} from '../legacy-address-dedupe.mjs';

const owner=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const backend=readFileSync(new URL('../customer-backend.mjs',import.meta.url),'utf8');
const router=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const js=owner.match(/<script>([\s\S]*?)<\/script>/)?.[1];

test('old customer tab restores its real loader, without calling an undefined function',()=>{
 assert.match(js,/async function loadLedgerMonthCustomers\(/);
 assert.match(js,/if\(tab==='old'\)/);
 assert.match(js,/void loadLedgerMonthCustomers\(\)/);
 assert.match(owner,/id="crmSignedHistory"/);
 assert.match(owner,/id="crmSignedHistoryRows"/);
 assert.match(js,/legacyAddressDirectory|\/api\/v2\/admin\/legacy\/address-directory/);
 assert.match(js,/customerRecord\.ledgerCustomers=data\.addresses/);
 assert.doesNotThrow(()=>new vm.Script(js));
});

test('old customer directory is signed and read-only; one card per delivery location',()=>{
 assert.match(router,/pathname==='\/api\/v2\/admin\/legacy\/address-directory'/);
 assert.match(router,/owner\(actor\)/);
 assert.match(backend,/export async function legacyAddressDirectory\(/);
 assert.match(backend,/readMinhSatori\('orders\.list',\{from:w\.from,to:w\.to,limit:100\}\)/);
 assert.match(backend,/groupHistoricalAddresses\(all\)/);
 const many=[2,3,4,9];
 for(const n of many){
  const rows=Array.from({length:n},(_,i)=>({
   address:i%2?'42 Đường Số 95, Cát Lái':'42 Duong So 95 Cat Lai',
   date:String(i+1).padStart(2,'0')+'/10/2026',
   invoiceNo:1000+i,name:'Recipient '+i,phoneCandidate:'090000000'+i
  }));
  const unique=groupHistoricalAddresses(rows);
  assert.equal(unique.length,1);assert.equal(unique[0].invoiceNo,1000+n-1);
 }
});

test('owner can configure old Gmail without phone; normal registration keeps shipping contact validation',()=>{
 const base={fullName:'CTV Verified Old',email:'ctv.owner@example.invalid',
  address:'42 Street 95 Thu Duc',requestedType:'collaborator',
  discountBps:2000,collaboratorBps:3500,phone:''};
 assert.equal(validateCustomerProfile(base,{admin:true,phoneOptional:true}).phone,'');
 assert.throws(()=>validateCustomerProfile(base,{admin:true}),/CUSTOMER_FIELD_INVALID/);
 assert.throws(()=>validateCustomerProfile({...base,phone:'123'},{admin:true,phoneOptional:true}),/CUSTOMER_PHONE_INVALID/);
 assert.match(backend,/phoneOptional:true/);
 assert.match(backend,/if\(data\.phone\)await c\.query\('INSERT INTO satori_v2_registrations/);
 assert.match(js,/SĐT liên hệ \(tùy chọn\)/);
 assert.match(js,/\/api\/v2\/admin\/customer-leads','POST'/);
 assert.match(js,/\/api\/v2\/admin\/legacy\/activate-saved','POST'/);
 assert.match(js,/\/api\/v2\/admin\/legacy\/bind-history','POST'/);
});

test('linking never uses a phone number or matching names as identity proof',()=>{
 assert.match(backend,/LEGACY_VERIFIED_GMAIL_MISMATCH/);
 assert.match(backend,/LEAD_LINKED_TO_ANOTHER_ACCOUNT/);
 assert.match(backend,/LEGACY_INVOICE_ALREADY_OWNED/);
 assert.match(js,/target\.email\.toLowerCase\(\)!==String\(item\.email\|\|''\)\.toLowerCase\(\)/);
 assert.doesNotMatch(backend,/check\(phone,'LEGACY_BIND_MISSING_CONTACT'/);
});
