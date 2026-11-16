# Synthetic staging ONLY. This script confirms fake invoice changes authorized for testing.
# Run: python customer-ai-chat-prototype/account-v2/staging/smoke.py
import json,urllib.request,uuid,time
BASE='https://minh-satori-grok-synthetic-staging.onrender.com'
RPC=BASE+'/mcp/grok/synthetic-only-public-fixtures-never-real-invoices-20261116'
def request(path,body=None):
 req=urllib.request.Request(path,data=None if body is None else json.dumps(body).encode(),headers={'content-type':'application/json'})
 with urllib.request.urlopen(req,timeout=35) as r:return r.read()
def tool(name,args={}):
 out=json.loads(request(RPC,{'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}}))
 assert not out.get('error'),out
 out=out['result'];assert not out.get('isError'),out
 return out['structuredContent']
def done(name):print('PASS',name,flush=True)
health=json.loads(request(BASE+'/healthz'));assert health['syntheticOnly'] and not health['officialLedgerConnected'];done('health: fake ledger only')
listed=json.loads(request(RPC,{'jsonrpc':'2.0','id':1,'method':'tools/list'}))['result']['tools'];assert any(t['name']=='satori_order_mark_paid_confirm' for t in listed);done('MCP discovery '+str(len(listed))+' tools')
assert tool('satori_order_get',{'invoiceNo':501})['order']['total']==300000;done('read exact seeded invoice')
assert tool('satori_products_search',{'q':'Nước Giả'})['count']>=1;done('synthetic catalogue')
customer='Khách Giả HTTP '+uuid.uuid4().hex[:8]
draft=tool('satori_order_draft',{'newCustomer':True,'customer':{'name':customer,'phone':'0900000999','location':'01 Đường Giả HTTP'},'vatRate':8,'items':[{'product':'Nước Giả','qty':1,'unitPrice':100000},{'product':'Cọc Giả','qty':1,'unitPrice':20000,'vatExempt':True}]})
assert draft['total']==128000
a=tool('satori_order_confirm',{'draftId':draft['draftId']});assert a['state']=='COMMITTED';no=a['invoiceNo'];done('create + per-line VAT')
b=tool('satori_order_confirm',{'draftId':draft['draftId']});assert b['duplicate'] and b['invoiceNo']==no;done('create retry does not duplicate')
row=tool('satori_order_get',{'invoiceNo':no})['order'];assert row['total']==128000 and row['vatMode']=='per_line';done('exact readback VAT')
listed=tool('satori_orders_list',{'customer':customer});assert listed['count']==1;done('find created invoice')
edit={'priceMode':'exclusive','vatRate':8,'items':[{'product':'Nước Giả','qty':2,'unitPrice':100000},{'product':'Cọc Giả','qty':1,'unitPrice':20000,'vatExempt':True}]}
p=tool('satori_order_preview_update',{'invoiceNo':no,'reason':'Sửa giả HTTP','order':edit});assert p['after']['total']==236000;done('preview per-line VAT')
e=tool('satori_order_update_request',{'invoiceNo':no,'reason':'Sửa giả HTTP','order':edit});assert tool('satori_order_update_confirm',{'requestId':e['requestId']})['state']=='DONE';done('edit')
audit=tool('satori_order_audit_history',{'invoiceNo':no});assert audit['invoiceNo']==no
# The audit's entry requestId is the canonical undo key, not the V2 row UUID.
entries=audit.get('entries',audit.get('history',[]));assert entries,audit
undo=tool('satori_order_undo_update_request',{'invoiceNo':no,'reason':'Hoàn tác giả HTTP','undoRequestId':entries[-1]['requestId']});assert tool('satori_order_undo_update_confirm',{'requestId':undo['requestId']})['state']=='DONE';assert tool('satori_order_get',{'invoiceNo':no})['order']['total']==128000;done('edit history + undo')
for change in ['customer_paid','customer_unpaid','satori_paid','satori_unpaid']:
 p=tool('satori_payment_request',{'invoiceNo':no,'reason':'Chứng từ giả HTTP','change':change});assert tool('satori_payment_confirm',{'requestId':p['requestId']})['state']=='DONE'
done('four payment directions')
row=tool('satori_order_get',{'invoiceNo':no})['order']
p=tool('satori_order_mark_paid_request',{'invoiceNo':no,'id':row['ledgerId'],'expectedName':customer,'expectedTotal':128000,'customerPaid':True,'satoriPaid':True,'proofNote':'Chứng từ giả TWO-FLAGS-HTTP'})
assert tool('satori_order_mark_paid_confirm',{'requestId':p['requestId']})['state']=='DONE'
assert tool('satori_order_mark_paid_confirm',{'requestId':p['requestId']})['duplicate'];done('two payment flags + confirm replay')
assert tool('satori_debt_summary')['source']=='debt.summary';done('debt report')
pdf=tool('satori_invoice_pdf',{'invoiceNo':no});assert pdf['sizeBytes']>1000;assert pdf['downloadUrl'].startswith(BASE+'/mcp/grok-files/');assert request(pdf['downloadUrl']).startswith(b'%PDF-');done('invoice PDF rendering and signed download')
statement=tool('satori_debt_statement_pdf',{'days':30});assert statement['sizeBytes']>1000;done('debt PDF')
# Restore both flags before trash, matching existing production protections.
for change in ['customer_unpaid','satori_unpaid']:
 p=tool('satori_payment_request',{'invoiceNo':no,'reason':'Trả trạng thái giả','change':change});tool('satori_payment_confirm',{'requestId':p['requestId']})
t=tool('satori_order_trash_request',{'invoiceNo':no,'reason':'Xóa giả HTTP'});assert tool('satori_order_trash_confirm',{'requestId':t['requestId']})['state']=='DONE';assert tool('satori_trash_list',{'query':str(no)})['count']==1
r=tool('satori_order_restore_request',{'invoiceNo':no,'reason':'Khôi phục giả HTTP'});assert tool('satori_order_restore_confirm',{'requestId':r['requestId']})['state']=='DONE';done('trash + restore')
q=tool('satori_pending_pdf_deliveries');assert any(x['invoiceNo']==no for x in q['deliveries']),q;done('PDF queue populated, nothing sent')
print('ALL_HTTP_SMOKE_PASS',no,flush=True)
