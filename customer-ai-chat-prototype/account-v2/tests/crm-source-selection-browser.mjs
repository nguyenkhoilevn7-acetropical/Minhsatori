// Isolated browser regression: real production binding panel, synthetic APIs only.
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const panel=html.slice(html.indexOf('function legacyBindingPanel(){'),html.indexOf('\nfunction drawCustomers(){'));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.setContent('<main id="root"></main>');
 await page.addScriptTag({content:`
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e};
 const iconButton=(label)=>make('button',label);
 const customerRecord={leads:[{id:'lead-one',active:true,fullName:'Synthetic Owner',email:'owner@example.invalid',requestedType:'retail',discountBps:2000}],registered:[{id:'account-one',email:'owner@example.invalid',name:'Synthetic Owner',accessStatus:'PENDING',revision:1,requestedType:'retail',discountBps:2000}]};
 const calls=[];
 const api=async(url,method,body)=>{
  calls.push({url,method,body});
  if(url.includes('/search?'))return {revision:42,truncated:false,addressGroups:[{address:'10 Test Road',name:'Synthetic Owner',invoiceCount:2,refs:[{invoiceNo:85,sourceId:'1792100000000'},{invoiceNo:5960,sourceId:'1793270028008'}]}]};
  return {linkedInvoices:2,uniqueAddresses:1};
 };
 const loadCustomers=async()=>{};
 const crmStatus=()=>{};
 window.confirm=()=>true;
 ${panel}
 document.getElementById('root').append(legacyBindingPanel());
 window.testCalls=calls;
 `});
 await page.getByText('Liên kết Gmail & lịch sử · một thao tác',{exact:true}).click();
 await page.getByLabel('2. Tài khoản Google V2 đã xác minh').selectOption('account-one');
 await page.getByPlaceholder('3. Tìm hóa đơn bằng tên / địa chỉ / SĐT').fill('Synthetic Owner');
 await page.getByRole('button',{name:'Tra cứu hóa đơn',exact:true}).click();
 await page.getByRole('checkbox').check();
 await page.getByPlaceholder('3. Tìm hóa đơn bằng tên / địa chỉ / SĐT').fill('Changed unrelated query');
 await page.getByRole('button',{name:'Xác nhận liên kết & kích hoạt',exact:true}).click();
 const submitted=await page.evaluate(()=>window.testCalls.find(x=>x.url.endsWith('/bind-history')));
 assert.equal(submitted.body.query,'Synthetic Owner','selected source uses completed search, not edited text');
 assert.deepEqual(submitted.body.refs,[{invoiceNo:85,sourceId:'1792100000000'},{invoiceNo:5960,sourceId:'1793270028008'}]);
 await page.getByLabel('1. Hồ sơ Khách cũ').selectOption('lead-one');
 assert.equal(await page.getByRole('checkbox').count(),0,'changing identity clears all old source selections');
 console.log('PASS browser: search snapshot and lead-change isolation; synthetic APIs only');
}finally{await browser.close()}
