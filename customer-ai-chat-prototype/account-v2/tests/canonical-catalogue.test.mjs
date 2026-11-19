import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCanonicalCatalogue} from '../canonical-catalogue.mjs';
const packet={revision:165,data:{revision:165,source:'drive-ledger:satori_catalogue_v15',
 products:[{code:'TP-00003',name:'Satori 500ml',unit:'Thùng',listPrice:98000}]}};
const error=fn=>{try{fn();return null}catch(e){return e.code}};
test('canonical read-only catalogue accepted only with matched revision',()=>{
 const r=validateCanonicalCatalogue(packet);
 assert.equal(r.revision,165);assert.equal(r.products[0].listPrice,98000);
 assert.ok(Object.isFrozen(r.products[0]));
});
test('reject browser/fallback/partial ledger envelopes',()=>{
 assert.equal(error(()=>validateCanonicalCatalogue({...packet,data:{...packet.data,source:'client'}})),'CATALOGUE_SOURCE_UNTRUSTED');
 assert.equal(error(()=>validateCanonicalCatalogue({...packet,revision:166})),'CATALOGUE_SOURCE_UNTRUSTED');
 assert.equal(error(()=>validateCanonicalCatalogue({...packet,data:{...packet.data,products:[]}})),'CATALOGUE_SIZE_INVALID');
});
test('reject duplicate SKUs, invalid prices and corrupted units',()=>{
 const p=packet.data.products[0];
 assert.equal(error(()=>validateCanonicalCatalogue({...packet,data:{...packet.data,products:[p,p]}})),'CATALOGUE_PRODUCT_INVALID');
 assert.equal(error(()=>validateCanonicalCatalogue({...packet,data:{...packet.data,products:[{...p,listPrice:-1}]}})),'CATALOGUE_PRODUCT_INVALID');
 assert.equal(error(()=>validateCanonicalCatalogue({...packet,data:{...packet.data,products:[{...p,unit:''}]}})),'CATALOGUE_PRODUCT_INVALID');
});
