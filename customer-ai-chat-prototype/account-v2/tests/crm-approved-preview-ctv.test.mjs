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

test('role and lifecycle actions never inherit full-row grid span',()=>{
 // Regression: screenshot after 0.4.24 showed vertically stacked role buttons,
 // one narrow Save followed by full-width Pause and Revoke.
 assert.doesNotMatch(owner,/\.crm-role-editor button\{grid-column:1\/-1;justify-self:start\}/);
 assert.match(owner,/\.crm-role-editor>form>button\[type="submit"\]\{grid-column:1\/-1;justify-self:start\}/);
 assert.match(owner,/#legacyConsole \.crm-role-editor \.crm-role-options>button\{grid-column:auto!important;justify-self:stretch!important;grid-row:auto!important;\}/);
 assert.match(owner,/#legacyConsole \.crm-role-editor \.crm-card-footer>button\{grid-column:auto!important;grid-row:auto!important;justify-self:stretch!important;\}/);
 assert.match(ownerScript,/footer\.append\(save\)/);
 assert.match(ownerScript,/footer\.append\(pause,revoke\)/);
 assert.match(ownerScript,/roleRow\.append\(make\('strong','Vai trò'\),crmRoleChoices\(role\)\)/);
});

test('invoice recipients are unique by normalized ADDRESS, not invoice or phone',()=>{
 const defs=['crmRecipientAddressKey','crmRecipientNameKey','crmUniqueLegacyRecipients','crmUniqueSavedAddressGroups'];
 const source=defs.map(name=>{
  const start=ownerScript.indexOf('function '+name+'(');
  assert.ok(start>=0,name+' not found');
  const next=ownerScript.indexOf('\nfunction ',start+10);
  return ownerScript.slice(start,next>=0?next:undefined);
 }).join('\n');
 const records=[
  {invoiceNo:5935,name:'Hà Minh Nguyệt',phoneCandidate:'0338915675',
   address:'R4-26 Đường số 6, Tân Phong'},
  {invoiceNo:5917,name:'Hà  Minh Nguyệt',phoneCandidate:'0338915675',
   address:'R4-26  ĐƯỜNG số 6, Tân Phong'},
  {invoiceNo:6011,name:'Hà Minh Nguyệt',phoneCandidate:'0983000970',
   address:'11 Trần Quý Kiên'},
  {invoiceNo:6012,name:'Khách khác',phoneCandidate:'0338915675',
   address:'11 Trần Quý Kiên'}
 ];
 const ctx=vm.runInNewContext(source+'; ({keys:crmUniqueLegacyRecipients(records,"Hà Minh Nguyệt"),saved:crmUniqueSavedAddressGroups([{id:"a",address:"R4-26 Đường số 6"},{id:"b",address:"R4-26  ĐƯỜNG số 6"},{id:"c",address:"R4/26 Đường số 6"}])})',{records});
 assert.equal(ctx.keys.length,2);
 assert.deepEqual(Array.from(ctx.keys[0].invoiceNos).sort(),[6011]);
 assert.deepEqual(Array.from(ctx.keys[1].invoiceNos).sort(),[5917,5935]);
 assert.equal(ctx.saved.length,2);
 assert.equal(ctx.saved[0].length,2);
 assert.equal(ctx.saved[1].length,1);
});

test('already-imported original invoices are never reimported by recipient directory',()=>{
 assert.match(ownerScript,/function renderLegacyRecipientDirectory\(host,ownerName,presetAccount=null\)/);
 assert.match(ownerScript,/\/api\/v2\/admin\/legacy\/search\?query=/);
 const start=ownerScript.indexOf('async function renderLegacyRecipientDirectory(');
 const end=ownerScript.indexOf('\nfunction drawLedgerPreview(){',start);
 const view=ownerScript.slice(start,end);
 assert.doesNotMatch(view,/\/api\/v2\/admin\/legacy\/import/);
 assert.match(view,/\/api\/v2\/admin\/addresses','POST'/);
 assert.match(view,/\/api\/v2\/admin\/policies','POST'/);
 assert.match(view,/accountSelect\.addEventListener\('change'/);
 assert.match(view,/confirm\('Gắn địa chỉ/);
 assert.match(ownerScript,/e\.message==='LEGACY_INVOICE_ALREADY_IMPORTED'/);
 assert.match(ownerScript,/addressGroups=crmUniqueSavedAddressGroups\(a\.addresses\)/);
 assert.match(ownerScript,/members\.find\(x=>x\.id===choose\.value\)/);
});

test('all verified CTV and agency accounts share deduplicated old-recipient directory',()=>{
 const dir=ownerScript.slice(
  ownerScript.indexOf('async function renderLegacyRecipientDirectory('),
  ownerScript.indexOf('\nfunction drawLedgerPreview(){'));
 const cards=ownerScript.slice(
  ownerScript.indexOf('async function renderOwnerCtvClientCards('),
  ownerScript.indexOf('/* Role and tiered pricing editor:'));
 const roles=ownerScript.slice(
  ownerScript.indexOf('function rolePricingEditor('),
  ownerScript.indexOf("byId('crmLedgerMonth').value="));
 assert.match(dir,/\['collaborator','agency'\]\.includes\(a\.requestedType\)/);
 assert.match(dir,/p\.type===account\.requestedType/);
 assert.match(dir,/chosenProfile\.type==='collaborator'\?main\?\.collaboratorBps:main\?\.discountBps/);
 assert.match(dir,/selectedProfile\.type==='collaborator'\?\{collaboratorBps:selectedCap\}:\{\}/);
 assert.match(dir,/confirm\('Gắn địa chỉ/);
 assert.match(cards,/x\.type===account\.requestedType/);
 assert.match(cards,/cap=isCtv\?main\?\.collaboratorBps:main\?\.discountBps/);
 assert.match(cards,/isCtv\?\{collaboratorBps:cap\}:\{\}/);
 assert.match(cards,/addressGroups=crmUniqueSavedAddressGroups\(a\.addresses\)/);
 assert.match(roles,/isPartner=isCtv\|\|role\.value==='agency'/);
 assert.match(roles,/clients\.hidden=!isPartner/);
 assert.doesNotMatch(dir,/\/api\/v2\/admin\/legacy\/import/);
 assert.doesNotThrow(()=>new vm.Script(ownerScript));
});

test('old customer invoice actions are one nested source, never two peer import paths',()=>{
 const start=owner.indexOf('<details id="crmLedgerDiscovery"');
 const advanced=owner.indexOf('<details id="legacyLedgerDisclosure"',start);
 const panelClose=owner.indexOf('</section>',start);
 assert.ok(start>=0&&advanced>start&&advanced<panelClose);
 assert.match(owner.slice(start,panelClose),/Nâng cao · tìm hóa đơn để tạo hồ sơ chưa liên kết/);
 assert.equal((owner.match(/id="legacySearchForm"/g)||[]).length,1);
 assert.equal((owner.match(/id="legacyLedgerDisclosure"/g)||[]).length,1);
 assert.equal((owner.match(/id="crmLedgerDiscovery"/g)||[]).length,1);
});

test('partner cards have one saved-recipient CK editor plus only new invoice candidates',()=>{
 const view=ownerScript.slice(ownerScript.indexOf('async function renderLegacyRecipientDirectory('),
  ownerScript.indexOf('\nfunction drawLedgerPreview(){'));
 const cards=ownerScript.slice(ownerScript.indexOf('async function renderOwnerCtvClientCards('),
  ownerScript.indexOf('/* Role and tiered pricing editor:'));
 assert.match(view,/const fixedAccount=!!presetAccount&&accounts\.some/);
 assert.match(view,/accountRow\.hidden=fixedAccount/);
 assert.match(view,/if\(fixedAccount&&saved\.length\)\{alreadySaved\+\+;continue\}/);
 assert.match(view,/finally\{accountSelect\.disabled=fixedAccount\}/);
 assert.match(cards,/crmUniqueSavedAddressGroups\(a\.addresses\)/);
 assert.match(ownerScript,/!\['collaborator','agency'\]\.includes\(registeredAccount\.requestedType\)/);
 assert.match(cards,/Địa chỉ mới từ hóa đơn · kiểm tra & thêm/);
 assert.doesNotMatch(view,/\/api\/v2\/admin\/legacy\/import/);
 assert.doesNotThrow(()=>new vm.Script(ownerScript));
});
