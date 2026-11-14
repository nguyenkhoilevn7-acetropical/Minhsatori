import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=html.indexOf('async function changeProfile(forceDuringWrite=false){');
const end=html.indexOf("\n$('profile').onchange=changeProfile;",start);
assert.ok(start>=0&&end>start,'Actual profile-loading handler is required');
const actualHandler=html.slice(start,end);

function harness(){
 const elements={
  profile:{value:'p1',disabled:false},
  quickAgentProfile:{value:'p1',disabled:false},
  location:{value:'',disabled:false}
 };
 const requests=[];
 const notices=[];
 const sandbox={
  elements,requests,notices,
  me:{profiles:[{id:'p1'},{id:'p2'},{id:'p3'}]},
  asyncCall:(url)=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),
  '$':(id)=>elements[id],
  toast:(s)=>notices.push(s),
  clearPendingCatalogueProduct:()=>{},
  resetTestQuote:()=>{},
  invalidateCartPricing:()=>{},
  updateDeliveryGate:()=>{},
  renderBadge:()=>{},
  renderCart:()=>{},
  renderAddresses:()=>{}
 };
 const context=vm.createContext(sandbox);
 vm.runInContext(
  "let savingCart=false,busy=false,cartProfileLoadEpoch=0,"+
  "profileLoading=false,cartLoadedProfileId='p1',"+
  "deliverySelectionProfileId='p1',cart=[{code:'TP-00003',qty:1}],cartRev=4;"+
  "const call=asyncCall;\n"+actualHandler,context);
 return {elements,requests,notices,
  eval:(code)=>vm.runInContext(code,context)};
}

test('out-of-order profile reads never overwrite another customer cart',async()=>{
 const h=harness();
 const older=h.eval('changeProfile()');
 h.elements.profile.value='p2';
 const newest=h.eval('changeProfile()');
 assert.equal(h.requests.length,2);
 assert.match(h.requests[0].url,/profileId=p1/);
 assert.match(h.requests[1].url,/profileId=p2/);
 h.requests[1].resolve({lines:[{code:'TP-00058',qty:2}],revision:6});
 await newest;
 assert.equal(h.eval('cartLoadedProfileId'),'p2');
 assert.equal(h.eval('cart[0].code'),'TP-00058');
 h.requests[0].resolve({lines:[{code:'TP-00003',qty:99}],revision:99});
 await older;
 assert.equal(h.eval('cartLoadedProfileId'),'p2');
 assert.equal(h.eval('cart[0].qty'),2);
 assert.equal(h.eval('cartRev'),6);
 assert.equal(h.eval('profileLoading'),false);
});

test('a pending cart write refuses an involuntary profile switch',async()=>{
 const h=harness();
 h.eval('savingCart=true');
 h.elements.profile.value='p2';
 await h.eval('changeProfile()');
 assert.equal(h.requests.length,0);
 assert.equal(h.elements.profile.value,'p1');
 assert.equal(h.elements.quickAgentProfile.value,'p1');
 assert.match(h.notices.join(' '),/Đang xử lý giỏ hàng/);
 assert.equal(h.eval('cart[0].qty'),1);
});

test('failed profile read restores last verified buyer and never displays unverified cart',async()=>{
 const h=harness();
 h.elements.profile.value='p3';
 const task=h.eval('changeProfile()');
 assert.equal(h.requests.length,1);
 h.requests[0].reject(Error('NETWORK_ERROR'));
 await task;
 assert.equal(h.elements.profile.value,'p1');
 assert.equal(h.elements.quickAgentProfile.value,'p1');
 assert.equal(h.eval('cartLoadedProfileId'),'p1');
 assert.equal(h.eval('cartRev'),4);
 assert.equal(h.eval('deliverySelectionProfileId'),null);
 assert.equal(h.eval('profileLoading'),false);
});

test('a conflict may refresh a cart while the original PUT remains unresolved',async()=>{
 const h=harness();
 h.eval('savingCart=true');
 const task=h.eval('changeProfile(true)');
 assert.equal(h.requests.length,1);
 h.requests[0].resolve({lines:[{code:'TP-00003',qty:3}],revision:5});
 await task;
 assert.equal(h.eval('cartRev'),5);
 assert.equal(h.eval('cart[0].qty'),3);
 assert.equal(h.eval('profileLoading'),false);
});

test('background polling drops requests when write starts after GETs were sent',()=>{
 assert.match(html,/if\(!me\|\|savingCart\|\|busy\|\|profileLoading\|\|v2SyncInFlight/);
 assert.match(html,/if\(\$\('profile'\)\.value!==profileId\|\|savingCart\|\|busy\|\|profileLoading\)return/);
 assert.match(html,/\$\('profile'\)\.disabled=writing\|\|busy/);
 assert.match(html,/\$\('quickAgentProfile'\)\.disabled=writing\|\|busy/);
 assert.match(html,/\$\('location'\)\.disabled=writing\|\|busy/);
 assert.match(html,/if\(profileLoading\|\|cartLoadedProfileId!==\$\('profile'\)\.value\)/);
 assert.match(html,/await changeProfile\(true\)/);
 assert.match(html,/if\(\$\('profile'\)\.value!==profileId\|\|cartLoadedProfileId!==profileId\)/);
});
