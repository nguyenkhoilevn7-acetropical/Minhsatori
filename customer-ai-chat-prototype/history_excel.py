"""Excel XLSX export of ONE authorized sandbox customer's order history.
Uses Python standard library; no bank details, tokens, macros or external requests.
Only the Node server performs customer link authorization before invoking this script.
"""
import io
import json
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape

orders = json.load(sys.stdin)
if not isinstance(orders, list) or len(orders) > 1500:
    raise SystemExit('Invalid sandbox customer history')
for order in orders:
    if not isinstance(order, dict) or order.get('sandbox') is not True or not str(order.get('ref','')).startswith('TEST-'):
        raise SystemExit('Non-test order rejected')

headers = ['STT', 'Ngày giờ đặt (VN)', 'Mã hóa đơn', 'Khách hàng', 'Sản phẩm',
           'ĐVT', 'Số lượng', 'Đơn giá sau CK', 'Chiết khấu (%)',
           'Thành tiền sản phẩm', 'VAT đơn hàng', 'Phí vận chuyển',
           'Tổng hóa đơn', 'Trạng thái', 'Ghi chú giao hàng']
rows = [headers]
vn = timezone(timedelta(hours=7))
def placed(value):
    try:
        dt = datetime.fromisoformat(str(value).replace('Z','+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(vn).strftime('%d/%m/%Y %H:%M:%S')
    except (TypeError, ValueError):
        return ''

def integer(value):
    try:
        n = round(float(value or 0))
        if not -1_000_000_000_000 < n < 1_000_000_000_000:
            raise ValueError('Out of bound')
        return int(n)
    except (ValueError, TypeError):
        return 0

for index, order in enumerate(orders, 1):
    items = order.get('items')
    if not isinstance(items, list) or not items:
        items = [order]
    for line_idx, item in enumerate(items):
        first = line_idx == 0
        unit_price = integer(item.get('unitPrice', order.get('unitPrice')))
        qty = integer(item.get('qty', order.get('qty')))
        rows.append([
            index if first else '', placed(order.get('createdAt')) if first else '',
            str(order.get('ref', '')) if first else '', str(order.get('name', '')) if first else '',
            str(item.get('product', '')), str(item.get('unit', order.get('unit','thùng'))),
            qty, unit_price, integer(item.get('discount', order.get('discount'))),
            integer(item.get('subtotal', unit_price * qty)),
            integer(order.get('vatAmount')) if first else '',
            integer(order.get('shipping')) if first else '',
            integer(order.get('total')) if first else '',
            str(order.get('status','')) if first else '',
            str(order.get('deliveryNote','')) if first else ''
        ])

def column(n):
    result = ''
    while n:
        n, mod = divmod(n - 1, 26)
        result = chr(65 + mod) + result
    return result

def cell(rownum, colnum, value, header=False):
    ref = column(colnum) + str(rownum)
    style = ' s="1"' if header else ''
    if isinstance(value, int):
        return '<c r="'+ref+'"'+style+'><v>'+str(value)+'</v></c>'
    # Shared-string-free inline text: spreadsheet formulas are never evaluated.
    value = str(value)
    return '<c r="'+ref+'"'+style+' t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>'

xml_rows = ''.join(
    '<row r="'+str(r)+'">'+''.join(cell(r, j, value, r==1) for j,value in enumerate(values,1))+'</row>'
    for r,values in enumerate(rows,1))
worksheet = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols><col min="1" max="1" width="7" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/><col min="4" max="4" width="25" customWidth="1"/><col min="5" max="5" width="44" customWidth="1"/><col min="6" max="6" width="12" customWidth="1"/><col min="7" max="13" width="19" customWidth="1"/><col min="14" max="14" width="20" customWidth="1"/><col min="15" max="15" width="44" customWidth="1"/></cols>
<sheetData>'''+xml_rows+'</sheetData><autoFilter ref="A1:O'+str(len(rows))+'"/></worksheet>'
types='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>'''
rels='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''
workbook='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Lich su don hang" sheetId="1" r:id="rId1"/></sheets></workbook>'''
wb_rels='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''
styles='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF066B9D"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>'''
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for filename, data in [('[Content_Types].xml',types),('_rels/.rels',rels),
                           ('xl/workbook.xml',workbook),('xl/_rels/workbook.xml.rels',wb_rels),
                           ('xl/styles.xml',styles),('xl/worksheets/sheet1.xml',worksheet)]:
        z.writestr(filename,data.encode('utf-8'))
sys.stdout.buffer.write(buf.getvalue())
