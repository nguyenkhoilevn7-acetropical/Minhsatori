import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listLocations,matchLocation,validateLocation,effectiveLocationDiscount} from '../delivery-locations.mjs';
const customer={name:'Dai ly Demo',phone:'0900000000',address:'Dia chi goc',locations:[{id:'a',label:'Chi nhanh Quan 1',recipient:'An',phone:'0900000001',address:'So 1 Quan 1'}, {id:'b',label:'Chi nhanh Quan 7',recipient:'Binh',phone:'0900000002',address:'So 7 Quan 7'}]};
test('one profile may have multiple validated locations',()=>{assert.equal(listLocations(customer).length,2);assert.equal(validateLocation({label:'Chi nhanh Q7',recipient:'Binh',phone:'0900000002',address:'So 7 Quan 7'}).label,'Chi nhanh Q7')});
test('specific named branch matches',()=>assert.equal(matchLocation(customer,'Giao chi nhanh Quan 7').location.id,'b'));
test('unspecified branch never guesses',()=>assert.equal(matchLocation(customer,'Cho toi 10 thung nuoc').status,'unresolved'));
test('old single address still works',()=>assert.equal(listLocations({name:'Demo',phone:'0900000000',address:'Dia chi thu'})[0].id,'primary'));
test('one agency link selects independent 20/25/30 percent discounts without cross-address bleed',()=>{
 const agency={discount:10,locations:[...Array(17)].map((_,i)=>({id:String(i+1),label:'Chi nhanh '+(i+1),recipient:'Test',phone:'0900000000',address:'So '+i+' duong Test',discountPercent:[20,25,30][i%3]}))};
 assert.equal(listLocations(agency).length,17);
 assert.equal(effectiveLocationDiscount(agency,listLocations(agency)[0]),20);
 assert.equal(effectiveLocationDiscount(agency,listLocations(agency)[1]),25);
 assert.equal(effectiveLocationDiscount(agency,listLocations(agency)[2]),30);
 assert.equal(Math.round(100000*(100-effectiveLocationDiscount(agency,agency.locations[0]))/100),80000);
 assert.equal(Math.round(100000*(100-effectiveLocationDiscount(agency,agency.locations[1]))/100),75000);
 assert.equal(Math.round(100000*(100-effectiveLocationDiscount(agency,agency.locations[2]))/100),70000);
 assert.equal(effectiveLocationDiscount(agency,{id:'legacy'}),10);
});
test('location discount is validated as whole percentage 0..70, never accepted from chat',()=>{
 const fields={label:'Chi nhanh demo',recipient:'Test',phone:'0900000000',address:'So 1 duong Test'};
 assert.equal(validateLocation({...fields,discountPercent:'25'}).discountPercent,25);
 for(const bad of [-1,71,25.5,'NaN','bad'])assert.equal(validateLocation({...fields,discountPercent:bad}),null);
});
