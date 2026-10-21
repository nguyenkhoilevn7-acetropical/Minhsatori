import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listLocations,matchLocation,validateLocation} from '../delivery-locations.mjs';
const customer={name:'Dai ly Demo',phone:'0900000000',address:'Dia chi goc',locations:[{id:'a',label:'Chi nhanh Quan 1',recipient:'An',phone:'0900000001',address:'So 1 Quan 1'}, {id:'b',label:'Chi nhanh Quan 7',recipient:'Binh',phone:'0900000002',address:'So 7 Quan 7'}]};
test('one profile may have multiple validated locations',()=>{assert.equal(listLocations(customer).length,2);assert.equal(validateLocation({label:'Chi nhanh Q7',recipient:'Binh',phone:'0900000002',address:'So 7 Quan 7'}).label,'Chi nhanh Q7')});
test('specific named branch matches',()=>assert.equal(matchLocation(customer,'Giao chi nhanh Quan 7').location.id,'b'));
test('unspecified branch never guesses',()=>assert.equal(matchLocation(customer,'Cho toi 10 thung nuoc').status,'unresolved'));
test('old single address still works',()=>assert.equal(listLocations({name:'Demo',phone:'0900000000',address:'Dia chi thu'})[0].id,'primary'));
