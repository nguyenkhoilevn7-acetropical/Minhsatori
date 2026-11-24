import test from 'node:test';
import assert from 'node:assert/strict';
import {interpret} from '../router.mjs';
import {interpretLegacyOrder} from '../legacy-interpret.mjs';
import {recognisedCatalogueQuestion,verifiedAvailabilityAnswer,missingV2CatalogueMessage} from '../catalogue-dialogue.mjs';

const satori500={code:'TP-00003',name:'Nước tinh khiết Satori 500ml',unit:'Thùng'};
const oiHong={code:'TP-00058',name:'Nước ép ổi hồng Satori Juice 24 lon/thùng',unit:'Thùng'};
const other={code:'TP-00001',name:'Nước tinh khiết Satori 350ml',unit:'Thùng'};
const poolWith=rows=>({query:async sql=>{
 assert.match(sql,/SELECT code,name,unit/);
 assert.match(sql,/WHERE active=true/);
 return {rows};
}});

test('500ml existence question is understood and answered from active V2 only',async()=>{
 const question=recognisedCatalogueQuestion('Satori có nước 500ml không?');
 assert.equal(question?.code,'TP-00003');
 const live=await interpret(poolWith([satori500]),{message:'Satori có nước 500ml không?'});
 assert.equal(live.provider,'verified-v2-catalogue');
 assert.match(live.message,/Có Nước tinh khiết Satori 500ml/);
 assert.equal(live.suggestedItems,undefined);
 const unsynced=await interpret(poolWith([other]),{message:'Satori có nước 500ml không?'});
 assert.match(unsynced.message,/TP-00003/);
 assert.match(unsynced.message,/Admin/);
 assert.equal(unsynced.suggestedItems,undefined);
});
test('no price is invented for price inquiries or missing V2 products',()=>{
 assert.equal(recognisedCatalogueQuestion('Giá Satori 500ml bao nhiêu?'),null);
 const question=recognisedCatalogueQuestion('Satori có nước 500ml không?');
 const answer=verifiedAvailabilityAnswer(question,[]);
 assert.match(answer,/chưa được xác nhận/);
 assert.doesNotMatch(answer,/\d{2,6}\s*(?:đ|VND)/);
});
test('existing short Vietnamese quantity orders only return active SKUs',async()=>{
 const cases=[['5 nước suối 500ml','TP-00003',5],['Cho 2 ổi','TP-00058',2]];
 for(const [message,code,qty] of cases){
  const understood=await interpretLegacyOrder(message);
  assert.equal(understood?.suggestedItems?.find(p=>p.code===code)?.qty,qty,
   'legacy parser should understand '+message);
  const ok=await interpret(poolWith([satori500,oiHong]),{message});
  assert.equal(ok?.suggestedItems?.find(p=>p.code===code)?.qty,qty);
  const blocked=await interpret(poolWith([other]),{message});
  assert.equal(blocked?.suggestedItems,undefined);
  assert.match(blocked?.message||'',new RegExp(code));
  assert.match(blocked?.message||'',/Giỏ hàng chưa thay đổi/);
 }
});
test('empty V2 catalogue stays fail-closed; no partial cart mutation',()=>{
 assert.match(missingV2CatalogueMessage([{code:'TP-00003',qty:5}],[]),/chưa có sản phẩm hoạt động/);
 const message=missingV2CatalogueMessage([
  {code:'TP-00003',qty:5},{code:'TP-00058',qty:2}
 ],[other]);
 assert.match(message,/TP-00003/);
 assert.match(message,/TP-00058/);
 assert.match(message,/không tự thay mã sản phẩm/);
 assert.equal(missingV2CatalogueMessage([{code:'TP-00003',qty:5}],[satori500]),null);
});
