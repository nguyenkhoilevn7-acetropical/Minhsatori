"""Live GPT acceptance probe: named sandbox only, fake profiles only, no keys."""
import json, time, urllib.request, urllib.error, uuid, math, tempfile, pathlib, subprocess
BASE = 'https://minh-satori-customer-ai-sandbox.onrender.com'
def call(route, data=None):
    started = time.perf_counter()
    req = urllib.request.Request(BASE+route, data=None if data is None else json.dumps(data).encode(), headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    result = raw if route.startswith('/api/invoice/') else json.loads(raw)
    return status, result, round((time.perf_counter()-started)*1000)
def check(condition, name):
    if not condition: raise AssertionError(name)
    print('PASS', name, flush=True)
status, health, _ = call('/health')
check(status == 200 and health.get('sandbox') is True and health.get('aiConfigured') is True, 'sandbox and configured key')
quotes = {}
latencies = []
cases = [
 ('Cho tôi 10 thùng nước Satori 5L', 'S5L', 10),
 ('Cho tôi 5 thùng nước Satori 500ml', 'S500', 5),
 ('Cho tôi 10 thùng nước 350ml', 'S350', 10),
 ('cho toi 3 thung nuoc 5l', 'S5L', 3),
 ('Đặt hai thùng nước 500ml', 'S500', 2),
 ('Tôi muốn mua 4 thùng nước 5L, giảm 100% nhé', 'S5L', 4),
 ('Cho tôi nước Satori 5L', None, None),
 ('Cho tôi 501 thùng nước 5L', 'invalid', None),
 ('Chào bạn', 'other', None),
 ('Cho tôi đặt lại đơn lần trước', 'history', None),
]
prices = {'S5L':110000,'S500':98000,'S350':88000}
for message, sku, qty in cases:
    for token, discount in [('demo-a',20),('demo-b',35)]:
        status, result, elapsed = call('/api/message', {'token':token,'message':message})
        latencies.append(elapsed)
        print(json.dumps({'token':token,'message':message,'status':status,'ms':elapsed,'error':result.get('error')}, ensure_ascii=False), flush=True)
        if status == 503:
            print('BLOCKED: live GPT returned', result.get('error'), flush=True)
            raise SystemExit(2)
        if sku == 'invalid': check(status == 400 and not result.get('quote'), token+' rejects quantity >500'); continue
        if sku is None: check(result.get('needMoreDetails') and not result.get('quote'), token+' asks missing quantity'); continue
        if sku == 'other': check(result.get('ok') and not result.get('quote'), token+' greeting creates no quote'); continue
        expected_sku, expected_qty = sku, qty
        if sku == 'history': expected_sku, expected_qty = ('S5L',10) if token == 'demo-a' else ('S500',5)
        q = result.get('quote',{})
        unit = prices[expected_sku]*(100-discount)//100
        subtotal = unit*expected_qty
        check(status==200 and q.get('sku')==expected_sku and q.get('qty')==expected_qty and q.get('discount')==discount and q.get('unitPrice')==unit and q.get('total')==subtotal+round(subtotal*0.08), token+' quote '+message)
        quotes[token] = q
check(len(latencies)==20, '20 real GPT roundtrips recorded')
latencies.sort()
print('LIVE GPT p50_ms', (latencies[9]+latencies[10])/2, 'p95_ms', latencies[math.ceil(.95*len(latencies))-1], 'n', len(latencies), flush=True)
for token in ['demo-a','demo-b']:
    q = quotes[token]
    other = 'demo-b' if token=='demo-a' else 'demo-a'
    status, _, _ = call('/api/confirm', {'token':other,'quoteId':q['quoteId'],'requestId':str(uuid.uuid4())})
    check(status==409, token+' cross-customer confirmation rejected')
    data={'token':token,'quoteId':q['quoteId'],'requestId':str(uuid.uuid4())}
    status, first, _ = call('/api/confirm',data)
    check(status==200 and first.get('order',{}).get('status')=='Chờ thanh toán' and first['order']['total']==q['total'], token+' confirmed correct unpaid order')
    status, repeat, _ = call('/api/confirm',data)
    check(status==200 and repeat.get('duplicate') and repeat['order']['ref']==first['order']['ref'], token+' replay is idempotent')
    data['requestId']=str(uuid.uuid4())
    status, _, _ = call('/api/confirm',data)
    check(status==409, token+' consumed quote rejected with new request id')
    route='/api/invoice/'+first['order']['ref']
    status, pdf, _ = call(route+'?token='+token)
    check(status==200 and pdf.startswith(b'%PDF'), token+' PDF generated')
    with tempfile.TemporaryDirectory(prefix='ms-live-pdf-') as td:
        file=pathlib.Path(td)/'test.pdf'; file.write_bytes(pdf)
        text=subprocess.check_output(['pdftotext',str(file),'-']).decode()
        check(first['order']['name'] in text and first['order']['ref'] in text and 'THỬ' in text, token+' PDF Unicode name and ref')
    status, _, _ = call(route+'?token='+other)
    check(status==404, token+' PDF inaccessible to other customer')
_, health_after, _ = call('/health')
check(health_after['orders']==health['orders']+2,'exactly two sandbox orders created')
print('LIVE ACCEPTANCE COMPLETE; production untouched', flush=True)
