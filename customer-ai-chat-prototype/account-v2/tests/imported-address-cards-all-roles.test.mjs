import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]||'';
const ownerRoute=readFileSync(new URL('../router.mjs',import.meta.url),'utf8');
const renderer=script.split('async function renderOwnerSavedDeliveryCards(account,wrap,{editable=true}={}){')[1]
 ?.split('async function renderOwnerCtvClientCards(account,wrap){')[0]||'';
const role=script.split('function rolePricingEditor(account,body,item,{old=false}={}){')[1]
 ?.split('// Monthly invoice and duplicate import UI retired;')[0]||'';
const historical=script.split('const oldFilters=[')[1]?.split('/* Owner-only customer lifecycle.')[0]||'';
const newCards=script.split('function drawCustomers(){')[1]?.split('const oldFilters=[')[0]||'';

test('all verified customer roles show saved delivery points, not only CTV / agency',()=>{
 assert.match(script,/async function renderOwnerSavedDeliveryCards\(account,wrap,\{editable=true\}=\{\}\)/);
 assert.match(role,/clients\.hidden=false/);
 assert.match(role,/if\(!loaded\)/);
 assert.match(role,/if\(\['collaborator','agency'\]\.includes\(account\.requestedType\)\)/);
 assert.match(role,/else void renderOwnerSavedDeliveryCards\(account,clients\)/);
 assert.doesNotMatch(role,/clients\.hidden=!isPartner/);
 assert.match(historical,/rolePricingEditor\(registeredAccount,body,item,\{old:true\}\)/);
 assert.match(newCards,/body\.append\(rolePricingEditor\(x,body,item\)\)/);
});
test('reads ALL verified account profiles and their imported saved points',()=>{
 assert.match(renderer,/\/api\/v2\/admin\/profiles\?accountId=/);
 assert.match(renderer,/Promise\.all\(profiles\.profiles\.map\(async profile=>/);
 assert.match(renderer,/\/api\/v2\/admin\/addresses\?profileId=/);
 assert.match(renderer,/return data\.addresses\.map\(row=>\(\{\.\.\.row,sourceProfileId:profile\.id\}\)\)/);
 assert.match(renderer,/const groups=crmUniqueSavedAddressGroups\(rows\)/);
 assert.match(renderer,/group\.find\(x=>x\.active\)\|\|group\[0\]/);
 assert.match(renderer,/row\.recipientName/);
 assert.match(renderer,/row\.recipientPhone/);
 assert.match(renderer,/row\.address/);
 assert.match(renderer,/row\.sourceProfileId/);
 assert.match(renderer,/ownerAddressEditor\(/);
 assert.match(renderer,/Điểm giao đã lưu/);
 assert.match(renderer,/groups\.length/);
 assert.match(renderer,/Không tải được địa chỉ đã lưu/);
});
test('pending imported accounts can view saved recipients without approval or rate writes',()=>{
 assert.match(newCards,/x\.accessStatus==='PENDING'&&x\.registrationRevision/);
 assert.match(newCards,/renderOwnerSavedDeliveryCards\(x,saved,\{editable:false\}\)/);
 assert.match(historical,/renderOwnerSavedDeliveryCards\(registeredAccount,saved,\{editable:false\}\)/);
 assert.doesNotMatch(renderer,/\/api\/v2\/admin\/legacy\/bind-history/);
 assert.doesNotMatch(renderer,/legacyInvoice|invoiceNo|sourceRevision/);
 assert.match(ownerRoute,/pathname==='\/api\/v2\/admin\/addresses'&&req.method==='GET'/);
 assert.doesNotThrow(()=>new vm.Script(script));
});
test('compact layout supports small screens without changing checkout or invoice rendering',()=>{
 assert.match(html,/\.crm-imported-delivery-list\{display:grid;gap:10px\}/);
 assert.match(html,/\.crm-imported-delivery-card\{display:flex;flex-direction:column/);
 assert.match(html,/@media\(min-width:660px\)/);
});
