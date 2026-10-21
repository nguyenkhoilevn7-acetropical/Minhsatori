/* Hundreds of synthetic, NON-personal Vietnamese order cases.
 * No external Gemini calls or production writes. Memory is opt-in and customer-scoped.
 */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseRules} from '../free-parser.mjs';
import {verifySandboxBackup,createSandboxBackup} from '../sandbox-backup.mjs';
import {syntheticOrderCases,ambiguousWater500,ambiguousWater500InComposite,brandAnswer,contactIntent,
 phoneConfirm,trainingProposal,makeCustomerPhraseMemory,GEMINI_FEW_SHOTS} from '../conversation-understanding.mjs';
let tests=0;const verify=(value,msg)=>{assert.ok(value,msg);tests++};
const cases=syntheticOrderCases();
verify(cases.length>=340,'at least 340 systematic fake order and ambiguity cases');
const skuFor={
 'Satori 500ml':'S500','Hikari 500ml':'TP-00081','Satori 350ml':'S350',
 'nước ép mãng cầu':'TP-00056','nước ép ổi hồng':'TP-00058','Premium 450ml':'TP-00051'
};
for(const test of cases){
 const a=parseRules(test.text);
 const p=test.sku||Object.entries(skuFor).find(([name])=>test.text.endsWith(name))?.[1];
 verify(p&&a?.qty===test.qty&&a?.sku===p&&!a.needMoreDetails,
  'resolved Satori-by-default or explicit-brand synthetic order: '+test.text);
}
verify(brandAnswer('Hikari')?.sku==='TP-00081','Hikari resolves only in pending brand context');
verify(brandAnswer('Satori')?.sku==='TP-00003','Satori resolves only in pending brand context');
verify(!ambiguousWater500('10 thùng nước suối 500'),'Satori default never asks for brand');
verify(!ambiguousWater500('10 thùng Hikari 500'),'never ask again for explicit Hikari');
verify(!ambiguousWater500InComposite('Cho 10 thùng nước suối 500 và 3 thùng ổi hồng'),'Satori default avoids brand-only block in mixed orders');
verify(!ambiguousWater500InComposite('Cho 10 thùng Satori 500ml và 3 thùng ổi hồng'),'explicit brand does not block a complete order');
verify(GEMINI_FEW_SHOTS.some(x=>x.includes('đổi địa chỉ')),'address policy appears in few-shots');
const addr=contactIntent('Đổi địa chỉ sang 123 đường Mẫu và đổi SĐT 0901234567');
verify(addr?.address===true,'mixed address+phone request remains blocked');
verify(contactIntent('Giao hàng đến 789 đường Mẫu')?.address,'new physical destination blocked');
verify(contactIntent('Giao sau 2 giờ chiều')===null,'delivery-time note is NOT mistaken for address edit');
const phone=contactIntent('Thay số điện thoại thành 090 123 4567');
verify(phone?.phone&&!phone.address&&phone.phoneNumber==='0901234567','phone locally parsed');
verify(phoneConfirm('Xác nhận đổi SĐT'),'requires explicit phone intent');
verify(!phoneConfirm('OK')&&!phoneConfirm('Đồng ý'),'casual OK cannot silently approve phone change');
const proposal=trainingProposal('Khi tôi nói suối xanh nghĩa là Satori 500ml');
verify(proposal?.code==='TP-00003'&&proposal.alias==='suoi xanh','consent-based training proposal');
verify(trainingProposal('Khi tôi nói suối 500 là Satori 500ml')?.invalid,'unsafe generic 500 alias blocked');
verify(trainingProposal('Khi tôi nói hàng riêng là trà sữa')?.invalid,'unknown product is not learnable');
const dir=mkdtempSync(path.join(tmpdir(),'satori-learning-'));
try{
 const memory=makeCustomerPhraseMemory(dir);
 verify(memory.list('customer-one').length===0,'memory initially empty');
 memory.remember('customer-one',proposal);
 verify(memory.expand('customer-one','Cho 3 thùng suối xanh').includes('TP-00003'),'confirmed nickname expands to canonical SKU');
 verify(!memory.expand('customer-two','Cho 3 thùng suối xanh').includes('TP-00003'),'customer aliases do not leak across links');
 const files=readFileSync(path.join(dir,'customer-phrases-SANDBOX.json'),'utf8');
 verify(!files.includes('customer-one')&&!files.includes('customer-two'),'raw customer-link tokens are not saved');
 const reopened=makeCustomerPhraseMemory(dir);
 verify(reopened.list('customer-one')[0]?.code==='TP-00003','memory survives process restart');
 const backup=createSandboxBackup({profiles:[],changeRequests:[],orders:[],drafts:[],phrases:reopened.snapshot()});
 const roundtrip=verifySandboxBackup(backup);
 verify(roundtrip.phrases.length===1,'confirmed memory included in checksummed Drive-ready archive');
 const second=mkdtempSync(path.join(tmpdir(),'satori-restored-'));
 try{
  const restored=makeCustomerPhraseMemory(second);
  restored.restore(roundtrip.phrases);
  verify(restored.expand('customer-one','4 thùng suối xanh').includes('TP-00003'),'encrypted snapshot restore returns alias');
 }finally{rmSync(second,{recursive:true,force:true})}
 reopened.forget('customer-one','suối xanh');
 verify(reopened.list('customer-one').length===0,'customer can remove learned alias');
}finally{rmSync(dir,{recursive:true,force:true})}
console.log('PASS '+tests+'/'+tests+' synthetic Vietnamese order understanding + safe opt-in customer memory');
