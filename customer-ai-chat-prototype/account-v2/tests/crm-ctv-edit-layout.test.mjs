import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../owner-catalogue.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]??'';
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]??'';
const render=script.slice(script.indexOf('function renderOwnerCtvClientCards('),
 script.indexOf('/* Role and tiered pricing editor:',script.indexOf('function renderOwnerCtvClientCards(')));

test('clicking CTV row ellipsis renders its editor as DIRECT GRID CHILD, not inside 30px options wrapper',()=>{
 assert.match(render,/let editorNode=null/);
 assert.match(render,/const editor=ownerAddressEditor\(profile\.id,row,customerEpoch,refresh\)/);
 assert.match(render,/if\(editorNode\)editorNode\.replaceWith\(editor\)/);
 assert.match(render,/else card\.append\(editor\)/);
 assert.match(render,/card\.append\(info,form\);list\.append\(card\);refreshCurrent\(\)/);
 assert.doesNotMatch(render,/editorSlot|card\.append\(info,form,editorSlot\)/);
 assert.match(render,/editor\.classList\.add\('crm-client-options'\)/);
 assert.match(render,/summary\.textContent=editor\.open\?'✕ Đóng chỉnh sửa':'⋯'/);
 assert.doesNotThrow(()=>new vm.Script(script));
});

test('expanded CTV editor spans ALL customer row grid columns; collapsed controls remain third column',()=>{
 assert.match(css,/#legacyConsole \.crm-ctv-client-row > \.crm-client-options\{\s*grid-column:3/);
 assert.match(css,/#legacyConsole \.crm-ctv-client-row > \.crm-client-options\[open\]\{\s*grid-column:1 \/ -1/);
 assert.match(css,/#legacyConsole \.crm-ctv-client-row > \.crm-client-options > form\.field-grid\{\s*display:grid!important;/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;/);
 assert.match(css,/@media \(max-width:720px\)\{\s*#legacyConsole \.crm-ctv-client-row > \.crm-client-options > form\.field-grid\{\s*grid-template-columns:minmax\(0,1fr\)!important;/);
 assert.match(css,/#legacyConsole \.crm-ctv-client-row > \.crm-client-options > form\.field-grid > button\[type="submit"\]\{\s*grid-column:1\/-1/);
});

test('editing a recipient preserves only its original PATCH API, account permissions and discount controls',()=>{
 assert.match(script,/api\('\/api\/v2\/admin\/addresses',row\?'PATCH':'POST',payload\)/);
 assert.match(script,/payload\.expectedRevision=row\.revision/);
 assert.match(script,/payload\.confirmed=true/);
 assert.match(render,/api\('\/api\/v2\/admin\/policies','POST'/);
 assert.match(render,/input\.disabled=!row\.active\|\|!hasApprovedCap/);
 assert.match(render,/form\.onsubmit=async event=>/);
 assert.doesNotMatch(render,/window\.location\.reload|location\.href/);
});
