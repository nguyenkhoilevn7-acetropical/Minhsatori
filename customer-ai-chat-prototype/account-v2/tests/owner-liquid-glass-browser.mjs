// Real owner markup and real presentation assets, with a strictly synthetic UI harness.
// No API calls, credentials, financial records or production endpoints.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  if(route.request().url()==='https://owner-liquid.test/') {
   // Suppress the real business script: test presentation and original navigation DOM only.
   const fixture=html.replace(/<script>[\s\S]*?<\/script>/,'')
    .replace('</body>',`<script>
    const nav=document.getElementById('ownerTabs');
    for(const button of nav.querySelectorAll('[data-owner-tab]'))button.addEventListener('click',()=>{
      for(const [tab,id] of [['new','crmConsole'],['old','legacyConsole'],['catalogue','console']])
        document.getElementById(id).hidden=tab!==button.dataset.ownerTab;
      for(const b of nav.querySelectorAll('[data-owner-tab]'))
        b.setAttribute('aria-selected',String(b===button));
    });
    </script></body>`);
   return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
  }
  return route.abort();
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://owner-liquid.test/');
 await page.locator('#s25-trigger').click();
 await page.locator('#s25-panel [data-owner-liquid-choice]').click();
 assert.equal(await page.locator('html').getAttribute('data-owner-liquid'),'on');
 assert.equal(await page.locator('#owner-liquid-shell').isVisible(),false,'unauthenticated nav must remain hidden');
 await page.evaluate(()=>{
  document.getElementById('ownerTabs').hidden=false;
  document.getElementById('ownerAuth').hidden=true;
  document.getElementById('crmConsole').hidden=false;
  document.getElementById('refresh').hidden=false;
  document.getElementById('ownerPdfToggle').hidden=false;
 });
 await page.locator('#s25-trigger').click();
 await page.locator('#owner-liquid-shell').waitFor({state:'visible'});
 assert.equal(await page.locator('#ownerTabs').count(),1);
 await page.locator('[data-owner-tab="old"]').click();
 assert.equal(await page.locator('#legacyConsole').isVisible(),true);
 assert.equal(await page.locator('#crmConsole').isVisible(),false);
 mkdirSync('liquid-ui-evidence',{recursive:true});
 await page.screenshot({path:'liquid-ui-evidence/desktop-expanded.png',animations:'disabled'});
 await page.locator('#lg-collapse').click();
 assert.equal(await page.locator('html').getAttribute('data-owner-liquid-compact'),'true');
 await page.screenshot({path:'liquid-ui-evidence/desktop-compact.png',animations:'disabled'});
 await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-owner-liquid'),'on');
 assert.equal(await page.locator('html').getAttribute('data-owner-liquid-compact'),'true');
 await page.evaluate(()=>{document.getElementById('ownerTabs').hidden=false;document.getElementById('ownerAuth').hidden=true;document.getElementById('crmConsole').hidden=false;});
 for(const [name,width,height] of [['phone',390,844],['fold-closed',344,882],['fold-open',760,900]]){
  await page.setViewportSize({width,height});
  await page.locator('#owner-liquid-shell').waitFor({state:'visible'});
  const bounds=await page.locator('#owner-liquid-shell').boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,name+' dock within viewport');
  assert.equal(await page.locator('[data-owner-tab="catalogue"] span').isVisible(),true);
  await page.locator('[data-owner-tab="catalogue"]').click();
  assert.equal(await page.locator('#console').isVisible(),true);
  await page.screenshot({path:'liquid-ui-evidence/'+name+'.png',animations:'disabled'});
 }
 await page.locator('#s25-trigger').click();
 await page.locator('#s25-panel [data-satori-layout-choice="classic"]').click();
 assert.equal(await page.locator('html').getAttribute('data-owner-liquid'),'off');
 assert.equal(await page.locator('#owner-liquid-shell').count(),0);
 assert.equal(await page.locator('#ownerTabs').count(),1);
 assert.deepEqual(errors,[]);
 console.log('PASS Liquid Glass browser: auth visibility, routes, collapse, persistence, mobile dock and Classic rollback');
}finally{await browser.close();}
