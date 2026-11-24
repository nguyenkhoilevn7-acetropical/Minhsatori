import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const from=(start,end)=>{
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Cannot find V2 section: '+start);
 return html.slice(a,b);
};

test('customer chat clearly distinguishes empty verified V2 catalogue from Gemini failure',()=>{
 assert.match(html,/id="catalogueNotice" hidden role="status"/);
 assert.match(html,/Chưa đồng bộ sản phẩm chính thức/);
 const render=from('function renderProducts(){','\/**\n * Prices in this');
 assert.match(render,/\$\('catalogueNotice'\)\.hidden=products\.length>0/);
 assert.match(render,/if\(!products\.length\)/);
 assert.doesNotMatch(render,/demoState\.products|SATORI_READ_HMAC_SECRET|API_KEY/);
});
test('pricing error has an explicit retry and cannot show an unverified final total',()=>{
 const summary=from('function showCartPriceSummary(pricing){','async function loadCartPricing(){');
 assert.match(summary,/if\(!pricing\)\{/);
 assert.match(summary,/Chưa xác minh được giá sau chiết khấu/);
 assert.match(summary,/retry\.onclick=\(\)=>\{if\(busy\|\|savingCart\)return;invalidateCartPricing\(\);renderCart\(\)\}/);
 assert.match(summary,/wrap\.append\(retry\)/);
 const verifyIndex=summary.indexOf("if(!pricing){");
 const pricedIndex=summary.indexOf("priceSummaryRow(wrap,'Tổng khách phải trả'");
 assert.ok(verifyIndex>=0&&pricedIndex>verifyIndex);
 assert.match(summary,/if\(error\)/);
});
test('foreground reconnect discards stale pricing errors without resubmitting orders',()=>{
 const onReconnect=from("window.addEventListener('online',()=>{",
  "$('agentAddressManage').onclick");
 assert.match(onReconnect,/if\(!me\|\|busy\|\|savingCart\)return/);
 assert.match(onReconnect,/invalidateCartPricing\(\);renderCart\(\)/);
 assert.doesNotMatch(onReconnect,/POST|PUT|\/api\/v2\/quote|\/api\/v2\/checkout/);
});
