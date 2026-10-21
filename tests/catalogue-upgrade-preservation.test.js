// Offline regression: a web UI version bump must never wipe owner-edited prices.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const marker='const DEFAULT_CATALOGUE = ';
const start=html.indexOf(marker);
assert.ok(start>0,'website should declare official default catalogue');
const first=html.indexOf('[',start),last=html.indexOf('];',first);
assert.ok(first>start&&last>first,'safe static JSON catalogue must exist');
const defaults=JSON.parse(html.slice(first,last+1));
assert.equal(defaults.length,20);
const beginning=html.indexOf('const APP_VERSION = ',last);
const ending=html.indexOf('// Helper dictionary by product code',beginning);
assert.ok(beginning>last&&ending>beginning,'locate exact catalogue migration and initialization');
const script=html.slice(beginning,ending)+'\nglobalThis.__loadedCatalogue=catalogue;';
function boot(entries){
 const map=new Map(entries);
 const removed=[];
 const store={getItem:k=>map.has(k)?map.get(k):null,
  setItem:(k,v)=>map.set(k,String(v)),
  removeItem:k=>{removed.push(k);map.delete(k)}};
 const context={localStorage:store,DEFAULT_CATALOGUE:defaults,JSON};
 vm.runInNewContext(script,context,{timeout:1000});
 return {catalogue:context.__loadedCatalogue,map,removed};
}
const edited=structuredClone(defaults);
edited[0].listPrice=777777;
edited[0].unitPrice=555555;
let test=boot([
 ['satori_app_version','old-ui-build'],
 ['satori_catalogue_v15',JSON.stringify(edited)],
 ['satori_catalogue_v14','outdated']
]);
assert.equal(test.catalogue[0].listPrice,777777,'owner price must survive UI upgrade');
assert.equal(test.catalogue[0].unitPrice,555555,'owner discounted price must survive UI upgrade');
assert.equal(test.map.get('satori_catalogue_v15'),JSON.stringify(edited),'no overwrite of v15 data');
assert.equal(test.removed.includes('satori_catalogue_v15'),false,'never remove live v15 catalogue');
assert.equal(test.map.has('satori_catalogue_v14'),false,'old v14 may be removed');
assert.ok(test.map.get('satori_app_version'),'UI version updated');
const initial=boot([]);
assert.equal(initial.catalogue.length,20,'first run still receives official defaults');
assert.ok(initial.map.has('satori_catalogue_v15'),'first run persists initial default');
const unchanged=boot([
 ['satori_app_version',test.map.get('satori_app_version')],
 ['satori_catalogue_v15',JSON.stringify(edited)]
]);
assert.equal(unchanged.catalogue[0].listPrice,777777,'second run does not reset owner price');
console.log('PASS website version-upgrade catalogue preservation (no network or Drive writes)');
