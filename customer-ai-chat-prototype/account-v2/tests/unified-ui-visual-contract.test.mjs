import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const V2=new URL('../',import.meta.url);
const prototype=new URL('../../',import.meta.url);
const root=new URL('../../../',import.meta.url);
const app=readFileSync(new URL('app.html',V2),'utf8');
const catalogue=readFileSync(new URL('owner-catalogue.html',V2),'utf8');
const admin=readFileSync(new URL('admin.html',prototype),'utf8');
const demo=readFileSync(new URL('ui-review/index.html',root),'utf8');

test('unified iOS light style is shared by real V2 app, owner and legacy admin UIs',()=>{
 for(const page of [app,catalogue,admin]){
  assert.match(page,/MINH SATORI UNIFIED LIGHT UI/);
  assert.match(page,/#007aff/i);
  assert.match(page,/<\/body>\s*<\/html>/i);
  assert.equal((page.match(/<style>/g)||[]).length,1);
  assert.equal((page.match(/<\/style>/g)||[]).length,1);
 }
 assert.match(app,/#eaf9f1/);
 assert.match(app,/#ecf5ff/);
});

test('visual style must not shadow V2 account/cart and checkout routes',()=>{
 for(const token of ['/api/v2/me','/api/v2/cart','/api/v2/quote','/api/v2/orders']){
  assert.ok(app.includes(token),'must preserve '+token);
 }
 for(const id of ['gate','signIn','messages','previewBanner','message','confirm']){
  assert.match(app,new RegExp('id=["\\x27]'+id+'["\\x27]'));
 }
 assert.match(app,/function|=>/);
});

test('existing admin customer and issued link features are still present',()=>{
 for(const id of ['copyLink','newOrderCount','pairDirectory','customerManagement']){
  assert.ok(admin.includes(id),'must preserve admin '+id);
 }
 assert.match(admin,/MINH SATORI UNIFIED LIGHT UI/);
});

test('visual owner catalogue still enforces admin and revision flow',()=>{
 for(const marker of ['/api/v2/me','/api/v2/admin/catalogue/refresh','ADMIN_REQUIRED']){
  assert.ok(catalogue.includes(marker),'must preserve '+marker);
 }
});

test('standalone visual preview is synthetic and cannot write real invoices',()=>{
 for(const token of ['DỮ LIỆU GIẢ LẬP','dữ liệu giả','KHÔNG KẾT NỐI KẾ TOÁN THẬT','Hóa đơn #']){
  assert.ok(demo.toLowerCase().includes(token.toLowerCase()),token);
 }
 assert.doesNotMatch(demo,/\bfetch\s*\(/);
 assert.doesNotMatch(demo,/XMLHttpRequest|sendBeacon|api\/v2\/confirm/i);
 assert.match(demo,/<\/body><\/html>/);
});


test('icon-first review tabs preserve existing screen IDs and accessible names',()=>{
 const nav=demo.match(/<nav aria-label="Xem trước các khu vực">([\s\S]*?)<\/nav>/)?.[1];
 assert.ok(nav, 'navigation must exist');
 assert.equal((nav.match(/<button /g)||[]).length,8);
 assert.equal((nav.match(/<svg /g)||[]).length,8);
 for(const id of ['ledger','customer','invoices','debt','orders','admin','chat','review']){
  assert.ok(nav.includes('data-view="'+id+'"'),'must retain '+id+' route');
  assert.ok(nav.includes('aria-controls="'+id+'"'),'must keep accessible '+id+' panel');
  assert.ok(demo.includes('id="'+id+'"'),'tab panel must remain '+id);
 }
 assert.match(nav, /<span>Kế toán<\/span>/);
 assert.match(nav, /<span>Quản trị<\/span>/);
 assert.match(demo, /nav button\.active\{background:linear-gradient/);
 assert.match(demo, /\.metric:nth-child\(2\)/);
 assert.match(demo, /\/\* END PREVIEW VÒNG 2 \*\//);
});
