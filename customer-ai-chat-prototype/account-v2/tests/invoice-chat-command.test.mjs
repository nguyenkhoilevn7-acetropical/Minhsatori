import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseInvoiceCommand,invoiceChatReply} from '../invoice-chat-command.mjs';

test('Gemini invoice intent is unambiguous and cannot rewrite a drink order',()=>{
 assert.deepEqual(parseInvoiceCommand('Cho tôi xem hóa đơn #5903'),{kind:'detail',invoiceNo:5903});
 assert.deepEqual(parseInvoiceCommand('tải bill 5918'),{kind:'detail',invoiceNo:5918});
 assert.deepEqual(parseInvoiceCommand('Lịch sử hóa đơn của tôi'),{kind:'history'});
 assert.equal(parseInvoiceCommand('10 thùng nước suối'),null);
 assert.equal(parseInvoiceCommand('cộng nợ 5903'),null);
});
test('chat invoice number is tenant scoped, never resolves another account by number',async()=>{
 const me=randomUUID(),id=randomUUID();
 const pool={async query(sql,params){
  assert.match(sql,/WHERE account_id=\$1 AND invoice_no=\$2/);
  assert.deepEqual(params,[me,5903]);
  return {rows:[{id,invoiceNo:5903}]};
 }};
 const result=await invoiceChatReply(pool,{id:me},'xem hóa đơn #5903');
 assert.equal(result.invoiceReference.id,id);
 assert.equal(result.invoiceReference.pdfAvailable,false);
 assert.equal(result.suggestedItems.length,0);
 assert.doesNotMatch(JSON.stringify(result),/downloadPath|fakePdf|commission/);
});
test('unbound and ambiguous invoice numbers are not guessed',async()=>{
 const me=randomUUID();
 let rows=[];
 const pool={query:async()=>({rows})};
 assert.match((await invoiceChatReply(pool,{id:me},'xem hóa đơn 5903')).message,/Chưa tìm thấy/);
 rows=[{id:randomUUID(),invoiceNo:5903},{id:randomUUID(),invoiceNo:5903}];
 assert.match((await invoiceChatReply(pool,{id:me},'xem hóa đơn 5903')).message,/nhiều hồ sơ/);
});
test('historical list never leaks other accounts and does not promise PDF ready',async()=>{
 const id=randomUUID(),binding=randomUUID();
 const pool={async query(sql,params){
  assert.match(sql,/WHERE account_id=\$1/);
  assert.equal(params[0],id);
  return {rows:[{id:binding,invoiceNo:5903,linkedAt:'2026-10-20'}]};
 }};
 const result=await invoiceChatReply(pool,{id},'lịch sử hóa đơn');
 assert.equal(result.invoiceReferences[0].id,binding);
 assert.equal(result.invoiceReferences[0].pdfAvailable,false);
 assert.deepEqual(result.suggestedItems,[]);
});
