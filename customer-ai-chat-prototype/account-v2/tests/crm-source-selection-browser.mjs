// Browser regression: the supported address-only import, synthetic APIs and accounts.
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const start=html.indexOf('function renderHistoricAddressImporter(){');
const end=html.indexOf('\nasync function searchSignedOldCustomers(){',start);
assert.ok(start>=0&&end>start,'owner address importer must remain available');
const importer=html.slice(start,end);
assert.doesNotMatch(html,/function legacyBindingPanel\(/);
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.setContent('<main id="root"><div id="crmImportDeliveryBody"></div></main>');
 await page.addScriptTag({content:`
 const byId=id=>document.getElementById(id);
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e};
 const iconButton=(label)=>make('button',label);
 const customerRecord={registered:[{id:'account-one',email:'verified@example.invalid',fullName:'Verified Test',accessStatus:'ACTIVE',registrationRevision:1,revision:3}]};
 const calls=[];
 const api=async(url,method,body)=>{
  calls.push({url,method,body});
  if(url.includes('/search?'))return {revision:42,truncated:false,addressGroups:[
   {address:'10 Test Road',name:'Synthetic Recipient',phone:'0901234567',
    ref:{invoiceNo:85,sourceId:'1792100000000'},invoiceCount:2}
  ]};
  if(url.includes('/import-delivery-points'))return {created:1,skippedExisting:0};
  throw Error('Unexpected API '+url);
 };
 const crmStatus=()=>{};
 window.confirm=()=>true;
 ${importer}
 renderHistoricAddressImporter();
 window.testCalls=calls;
 `});
 await page.locator('#crmImportDeliveryAccount').selectOption('account-one');
 await page.locator('#crmImportDeliveryQuery').fill('Synthetic Recipient');
 await page.getByRole('button',{name:'Tra địa chỉ',exact:true}).click();
 await page.getByRole('checkbox').check();
 await page.locator('#crmImportDeliveryQuery').fill('Unrelated typing without re-search');
 await page.getByRole('button',{name:'Import các địa chỉ đã chọn',exact:true}).click();
 const submitted=await page.evaluate(()=>window.testCalls.find(x=>x.url.endsWith('/import-delivery-points')));
 assert.ok(submitted,'address import endpoint called');
 assert.equal(submitted.body.accountId,'account-one');
 assert.equal(submitted.body.query,'Synthetic Recipient');
 assert.equal(submitted.body.sourceRevision,42);
 assert.equal(submitted.body.confirmed,true);
 assert.equal(submitted.body.identityConfirmed,true);
 assert.deepEqual(submitted.body.selected,[{invoiceNo:85,sourceId:'1792100000000'}]);
 const called=await page.evaluate(()=>window.testCalls.map(x=>x.url));
 assert.equal(called.some(x=>/\/bind-history|\/activate-saved/.test(x)),false);
 console.log('PASS browser: signed source selection and Gmail target only via address-only import');
}finally{await browser.close()}
