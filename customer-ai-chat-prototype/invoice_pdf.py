"""Minh Satori A4 PDF — invoice #5910-inspired layout, strictly non-payable sandbox.
A unique per-bill QR records test order reference and total, NOT bank transfer instructions.
"""
import sys, json, io, os, re, datetime
import qrcode
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.utils import simpleSplit
from reportlab.lib.utils import ImageReader

o = json.load(sys.stdin)
if not o.get('sandbox') or not str(o.get('ref', '')).startswith('TEST-'):
    raise SystemExit('Production invoices are not accepted by sandbox PDF generator')
fonts=['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf']
bolds=['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf']
font=next((p for p in [os.environ.get('PDF_FONT_PATH','')]+fonts if p and os.path.isfile(p)),None)
bold=next((p for p in bolds if os.path.isfile(p)),font)
if not font: raise SystemExit('No Unicode font installed')
pdfmetrics.registerFont(TTFont('MSVN',font))
pdfmetrics.registerFont(TTFont('MSVN-B',bold))

C_BLUE=HexColor('#066B9D')
C_DARK=HexColor('#142338')
C_GRAY=HexColor('#5A6472')
C_BORDER=HexColor('#CAD8E4')
C_LIGHT=HexColor('#EDF5FA')
W,H=A4
buf=io.BytesIO()
c=canvas.Canvas(buf,pagesize=A4,pageCompression=1)
c.setTitle('Minh Satori — Phieu don thu '+str(o['ref']))
def fmt(value):
    return f"{int(round(float(value or 0))):,}".replace(',','.')+' đ'
def text(x,y,value,size=8,bold=False,color=C_DARK):
    c.setFont('MSVN-B' if bold else 'MSVN',size)
    c.setFillColor(color)
    c.drawString(x,y,str(value))
def right(x,y,value,size=8,bold=False,color=C_DARK):
    c.setFont('MSVN-B' if bold else 'MSVN',size)
    c.setFillColor(color)
    c.drawRightString(x,y,str(value))
def wrapped(x,y,value,width,size=8,bold=False,leading=12):
    lines=simpleSplit(str(value),'MSVN-B' if bold else 'MSVN',size,width)
    for line in lines:
        text(x,y,line,size,bold)
        y-=leading
    return y
ones=['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín']
def group3(number,force_hundred=False):
    a=number//100;b=(number//10)%10;z=number%10
    result=[]
    if a>0:result.extend([ones[a],'trăm'])
    elif force_hundred and number>0:result.extend(['không','trăm'])
    if b>1:
        result.extend([ones[b],'mươi'])
        if z==1: result.append('mốt')
        elif z==5: result.append('lăm')
        elif z>0: result.append(ones[z])
    elif b==1:
        result.append('mười')
        if z==5:result.append('lăm')
        elif z>0:result.append(ones[z])
    elif z>0:
        if a>0 or force_hundred:result.append('lẻ')
        result.append(ones[z])
    return ' '.join(result)
def words(n):
    n=int(round(float(n or 0)))
    if n<=0:return 'Không đồng'
    if n>=10**12:return 'Số tiền lớn'
    sections=[];k=0
    while n:
        g=n%1000
        if g:sections.append((k,g))
        n//=1000;k+=1
    labels=['','nghìn','triệu','tỷ']
    parts=[]
    for i,(k,g) in enumerate(reversed(sections)):
        parts.append(group3(g,force_hundred=i>0 and g<100))
        if labels[k]:parts.append(labels[k])
    full=' '.join(parts)
    return full[0].upper()+full[1:]+' đồng chẵn'

# The header and footer already identify this as a test. Avoid an intrusive watermark
# across the customer/product sections of the reference invoice.
left=37;rightedge=W-37
logo_path=os.path.join(os.path.dirname(os.path.abspath(__file__)),'assets','logo-satori.jpg')
if os.path.isfile(logo_path):
    # The image is shipped with the app, not fetched from an external URL.
    try:
        c.drawImage(ImageReader(logo_path),left,H-111,width=63,height=63,preserveAspectRatio=True,anchor='c',mask='auto')
    except Exception as exc:
        raise SystemExit('Cannot embed official logo: '+str(exc))
text(left+70,H-53,'HỘ KINH DOANH MINH SATORI',11,True,C_BLUE)
text(left+70,H-69,'Mã số thuế: 075087004222',7.7)
text(left+70,H-82,'Hotline: 0903 772 980',7.7)
text(left+70,H-95,'96/41 Tôn Đản, Phường Khánh Hội, TP. Hồ Chí Minh',6.6)
right(rightedge,H-53,'PHIẾU XUẤT HÓA ĐƠN — BẢN THỬ',10.2,True)
right(rightedge,H-72,str(o['ref']),12.5,True,C_BLUE)
try:when=datetime.datetime.fromisoformat(o.get('createdAt','').replace('Z','+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=7))).strftime('%H:%M:%S %d/%m/%Y')
except Exception:when='Ngày thử nghiệm'
right(rightedge,H-86,when,7.7)
right(rightedge,H-101,'Chưa thanh toán',7.7)
c.setStrokeColor(C_BLUE);c.setLineWidth(1)
c.line(left,H-114,rightedge,H-114)

text(left,H-135,'THÔNG TIN KHÁCH HÀNG',9,True,C_BLUE)
y=H-152
y=wrapped(left,y,'Khách hàng: '+str(o.get('name','')),510,8.1)
y=wrapped(left,y,'Điện thoại: '+str(o.get('phone','')),510,8.1)
y=wrapped(left,y,'Địa chỉ giao: '+str(o.get('address','')),510,8.1)
if o.get('deliveryNote'):
    y-=3
    text(left,y,'LƯU Ý GIAO HÀNG (CHỜ XÁC NHẬN):',8.2,True,C_BLUE)
    y=wrapped(left,y-13,str(o['deliveryNote']),500,8,leading=12)
    y-=5
y=wrapped(left,y,'Mã số thuế: Không có',510,8.1)
top=min(y-20,H-224)

# A4 product grid. Fit every money value into its own cell; never clip the last digit.
# Column sum is exactly the printable A4 width (521 points).
widths=[24,178,40,27,69,38,74,71]
xs=[left]
for w in widths: xs.append(xs[-1]+w)
assert sum(widths)==521 and xs[-1]<=rightedge
headers=['STT','Tên sản phẩm','ĐVT','SL','Giá niêm yết','CK (%)','Đơn giá','Thành tiền']
rows=o.get('items') if isinstance(o.get('items'),list) and o.get('items') else [o]
if len(rows)>6: raise SystemExit('Too many product rows for sandbox PDF')
def fit_right(x,y,value,available,size=7,min_size=5.1,bold=False):
    value=str(value)
    face='MSVN-B' if bold else 'MSVN'
    while size>min_size and pdfmetrics.stringWidth(value,face,size)>available:
        size-=0.2
    if pdfmetrics.stringWidth(value,face,size)>available:
        raise ValueError('Numeric product cell exceeds maximum width')
    right(x,y,value,size,bold)
def fit_center(cx,y,value,available,size=7,min_size=5):
    value=str(value)
    while size>min_size and pdfmetrics.stringWidth(value,'MSVN-B',size)>available:
        size-=0.2
    if pdfmetrics.stringWidth(value,'MSVN-B',size)>available:
        raise ValueError('Table header or product cell exceeds maximum width')
    c.setFont('MSVN-B',size)
    c.setFillColor(C_DARK)
    c.drawCentredString(cx,y,value)
NAME_FONT_SIZE=9.5
NAME_LINE_HEIGHT=13
names=[simpleSplit(str(item.get('product','')),'MSVN',NAME_FONT_SIZE,widths[1]-10) or [''] for item in rows]
row_heights=[max(39,14+NAME_LINE_HEIGHT*len(lines)) for lines in names]
rowh=29
table_bottom=top-rowh-sum(row_heights)
if table_bottom<100: raise SystemExit('Product table too tall for A4')
c.setFillColor(C_BLUE)
c.rect(left,top-rowh,sum(widths),rowh,stroke=0,fill=1)
for i,lab in enumerate(headers):
    face='MSVN-B';size=6.45
    while size>5 and pdfmetrics.stringWidth(lab,face,size)>widths[i]-5: size-=0.15
    c.setFont(face,size)
    c.setFillColor(HexColor('#FFFFFF'))
    c.drawCentredString((xs[i]+xs[i+1])/2,top-18,lab)
c.setStrokeColor(C_BORDER);c.setLineWidth(.55)
for x in xs:c.line(x,table_bottom,x,top)
c.line(left,top-rowh,rightedge,top-rowh)
row_top=top-rowh
for idx,item in enumerate(rows):
    row_bottom=row_top-row_heights[idx]
    dataY=row_top-17
    fit_center((xs[0]+xs[1])/2,dataY,str(idx+1),widths[0]-5,7)
    for ii,line in enumerate(names[idx]):text(xs[1]+5,dataY-ii*NAME_LINE_HEIGHT,line,NAME_FONT_SIZE)
    unit=str(item.get('unit') or 'Thùng')
    unit_size=7.0
    while unit_size>5 and pdfmetrics.stringWidth(unit,'MSVN',unit_size)>widths[2]-7:unit_size-=0.2
    text(xs[2]+4,dataY,unit,unit_size)
    fit_right(xs[4]-5,dataY,str(int(item.get('qty') or 0)),widths[3]-9,7)
    fit_right(xs[5]-5,dataY,fmt(item.get('listPrice',item.get('unitPrice',0))),widths[4]-9,7)
    fit_right(xs[6]-5,dataY,str(item.get('discount',o.get('discount',0))),widths[5]-9,7)
    fit_right(xs[7]-5,dataY,fmt(item.get('unitPrice',0)),widths[6]-9,7)
    fit_right(xs[8]-6,dataY,fmt(item.get('subtotal',0)),widths[7]-10,7.1)
    c.line(left,row_bottom,rightedge,row_bottom)
    row_top=row_bottom
below=table_bottom-18
# Large orders continue their payment and signatures on a second A4 page.
second_page=below<383
if second_page:
    right(rightedge,29,'1 / 2',7,C_GRAY)
    c.showPage()
    text(left,H-49,'HỘ KINH DOANH MINH SATORI',10,True,C_BLUE)
    right(rightedge,H-49,'PHIẾU XUẤT HÓA ĐƠN — BẢN THỬ',8,True)
    right(rightedge,H-65,str(o['ref']),8,True,C_BLUE)
    c.setStrokeColor(C_BLUE);c.line(left,H-75,rightedge,H-75)
    below=H-103

text(left,below,'THÔNG TIN THANH TOÁN',8.7,True,C_BLUE)
text(left,below-16,'Ngân hàng: KHÔNG ÁP DỤNG (SANDBOX)',7.4)
text(left,below-30,'Số tài khoản: Không hiển thị trong bản thử',7.4)
text(left,below-44,'Chủ tài khoản: HKD MINH SATORI',7.4)
text(left,below-58,'Nội dung: '+str(o['ref']),7.4)
# Unique, machine-readable order QR without VietQR banking payload.
# Never route funds to a real account for a TEST invoice.
qr_payload='MINH-SATORI|SANDBOX|REF='+str(o['ref'])+'|TOTAL-VND='+str(int(round(float(o.get('total',0)))))
qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=4,border=2)
qr.add_data(qr_payload)
qr.make(fit=True)
qr_image=qr.make_image(fill_color='black',back_color='white').get_image()
c.drawImage(ImageReader(qr_image),left+6,below-163,width=92,height=92,mask='auto')
text(left+106,below-102,'QR tra cứu đơn thử',7.7,True,C_BLUE)
text(left+106,below-115,'Mã: '+str(o['ref']),6.7)
text(left+106,below-128,'KHÔNG CHUYỂN KHOẢN',6.8,True,C_GRAY)
tx=324;valueX=rightedge
right(valueX,below,fmt(o.get('subtotal',0)),8.1)
text(tx,below,'Tổng tiền hàng:',7.8)
text(tx,below-18,'Phí vận chuyển:',7.8)
right(valueX,below-18,fmt(o.get('shipping',0)),8.1)
text(tx,below-36,'Thuế VAT ('+str(o.get('vatRate',0))+'%):',7.8)
right(valueX,below-36,fmt(o.get('vatAmount',0)),8.1)
c.setStrokeColor(C_BORDER);c.line(tx,below-42,valueX,below-42)
text(tx,below-57,'TỔNG THANH TOÁN',8.3,True)
right(valueX,below-57,fmt(o.get('total',0)),10.3,True,C_BLUE)

noteY=below-182
word_end=wrapped(left,noteY,'Số tiền bằng chữ: '+words(o.get('total',0)),515,7.7,leading=11)
sigY=word_end-29
text(left+79,sigY,'ĐẠI DIỆN BÊN BÁN',8.2,True)
text(left+84,sigY-13,'(Ký, ghi rõ họ tên)',7.2)
text(left+79,sigY-74,'HKD MINH SATORI',8,True,C_BLUE)
cx=W/2+71
text(cx,sigY,'ĐẠI DIỆN BÊN MUA / NGƯỜI NHẬN',7.8,True)
text(cx+29,sigY-13,'(Ký, ghi rõ họ tên)',7.2)
wrapped(cx+24,sigY-74,o.get('name','Khách thử'),175,8,True)
if sigY-74<=49:
    raise SystemExit('Invoice signature overlaps A4 footer')
text(left,45,'SANDBOX — Phiếu thử nghiệm, không có giá trị thanh toán hoặc giao hàng.',7.3,True,C_GRAY)
right(rightedge,29,'2 / 2' if second_page else '1 / 1',7,C_GRAY)
c.showPage();c.save()
sys.stdout.buffer.write(buf.getvalue())
