import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const owner=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const gemini=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const ownerScript=owner.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const geminiScript=[...gemini.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
 .map(m=>m[1]).find(Boolean);

test('approved preview has a single native-compatible owner tab row',()=>{
 assert.equal((owner.match(/id="ownerTabs"/g)||[]).length,1);
 for(const tab of ['new','old','catalogue'])
  assert.match(owner,new RegExp('data-owner-tab="'+tab+'"'));
 assert.match(ownerScript,/activateOwnerTab\(tab\)/);
 assert.match(ownerScript,/const oldItems=\[\.\.\.registered\.filter/);
 assert.match(ownerScript,/registeredAccount\?\.accessStatus==='ACTIVE'/);
 assert.match(owner,/crm-customer-card/);
 assert.match(owner,/id="crmLedgerDiscovery" class="crm-ledger-discovery"/);
 assert.match(ownerScript,/if\(compact\)\{item\.append\(body\);return \{item,body\};\}/);
});

test('role switches and CTV dual discounts are bound to the real APIs',()=>{
 assert.match(ownerScript,/crmRoleChoices\(role\)/);
 assert.match(ownerScript,/rolePricingEditor\(account,body,item/);
 assert.match(ownerScript,/const ctv=rateField\('Chiết khấu CTV/);
 assert.match(ownerScript,/Chiết khấu mặc định cho khách của CTV/);
 assert.match(ownerScript,/ctvRate<customerRate/);
 assert.match(ownerScript,/\/api\/v2\/admin\/customer-role','PATCH'/);
 assert.match(ownerScript,/\/api\/v2\/admin\/policies','POST'/);
 assert.match(ownerScript,/renderOwnerCtvClientCards\(account,clients\)/);
});

test('Gemini CTV sheet reuses one editor and one server-approved client writer',()=>{
 assert.equal((gemini.match(/id="ctvCustomerDialog"/g)||[]).length,1);
 assert.match(gemini,/id="ctvSheetSave"/);
 assert.match(gemini,/id="ctvExistingTab"/);
 assert.match(gemini,/id="ctvNewTab"/);
 assert.match(geminiScript,/function openCtvSheet\(/);
 assert.match(geminiScript,/ctvSheetContents'\)\.append\(\$\('ctvClientPanel'\),\$\('addressForm'\)\)/);
 assert.match(geminiScript,/\/api\/v2\/ctv\/clients/);
 assert.match(geminiScript,/discountBps>ctvClientData\.collaboratorBps/);
 assert.match(geminiScript,/function closeCtvSheet\(/);
 assert.match(geminiScript,/rememberDeliveryRequest\(\{deliveryNote,requestedDeliveryAt:null\}\)/);
});

test('new mobile UI scripts compile and retain single-invoice safeguards',()=>{
 assert.ok(ownerScript);assert.ok(geminiScript);
 assert.doesNotThrow(()=>new vm.Script(ownerScript));
 assert.doesNotThrow(()=>new vm.Script(geminiScript));
 assert.match(ownerScript,/invoiceMode:'single'/);
 assert.match(ownerScript,/Hóa đơn cũ giữ nguyên|Không sửa hóa đơn cũ|Không sửa hóa đơn gốc/);
});

test('Android owner role/footer and CTV percent controls stay horizontal',()=>{
 assert.match(owner,/#legacyConsole \.crm-role-options\{display:grid!important;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
 assert.match(owner,/#legacyConsole \.crm-card-footer\{display:grid!important;grid-template-columns:/);
 assert.match(owner,/#legacyConsole \.crm-client-rate \.crm-client-save\{display:inline-flex!important/);
 assert.match(ownerScript,/control\.append\(field,make\('span','%','crm-percent-suffix'\)\)/);
 assert.match(ownerScript,/form\.append\(input,make\('span','%'\),save\)/);
});

test('same-name visual grouping preserves independent phone and account records',()=>{
 assert.match(ownerScript,/function crmNameGroups\(rows\)/);
 assert.match(ownerScript,/function crmGroupCards\(group,cards\)/);
 assert.match(ownerScript,/crmGroupCards\(group,cards\)/);
 const fn=ownerScript.match(/function crmNameGroups\(rows\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(fn);
 const records=[
  {id:'1',fullName:' Hà Minh Nguyệt ',phone:'0983000970'},
  {id:'2',fullName:'Hà  Minh Nguyệt',phone:'0768152072'},
  {id:'3',fullName:'Traky Sài Gòn',phone:'0931325049'}
 ];
 const groups=vm.runInNewContext(fn+'; crmNameGroups(records);',{records});
 assert.equal(groups.length,2);
 assert.equal(groups[0].rows.length,2);
 assert.equal(groups[0].rows[0].id,'1');
 assert.equal(groups[0].rows[1].phone,'0768152072');
 assert.equal(groups[1].rows[0].id,'3');
});
