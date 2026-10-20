"""Minh Satori A4 PDF: visual parity with website invoice, but strictly TEST data only.
NO real bank account and NO payment QR for sandbox.
"""
import sys, json, io, os, re, datetime
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

# Low-impact diagonal sandbox watermark
c.saveState()
c.translate(W/2,H/2)
c.rotate(33)
c.setFillColor(Color(.81,.85,.89,alpha=.22))
c.setFont('MSVN-B',64)
c.drawCentredString(0,0,'SANDBOX')
c.restoreState()

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

# Product table, website columns
widths=[25,190,39,27,72,36,70,62]
xs=[left]
for w in widths:xs.append(xs[-1]+w)
headers=['STT','Tên sản phẩm','ĐVT','SL','Giá niêm yết','CK (%)','Đơn giá','Thành tiền']
rowh=29
c.setFillColor(C_BLUE);c.rect(left,top-rowh,sum(widths),rowh,stroke=0,fill=1)
for i,lab in enumerate(headers):
    x1,x2=xs[i],xs[i+1]
    c.setFont('MSVN-B',6.55)
    c.setFillColor(HexColor('#FFFFFF'))
    c.drawCentredString((x1+x2)/2,top-18,lab)
c.setStrokeColor(C_BORDER);c.setLineWidth(.55)
for x in xs:c.line(x,top-rowh*2,x,top)
c.line(left,top-rowh*2,rightedge,top-rowh*2)
product=str(o.get('product',''))
name_lines=simpleSplit(product,'MSVN',7.1,widths[1]-10)[:2]
dataY=top-rowh-13.5
text(left+widths[0]/2-2,dataY,'1',7)
for ii,line in enumerate(name_lines):
    text(xs[1]+4,dataY-ii*10,line,7.1)
unit=str(o.get('unit') or 'Thùng')
text(xs[2]+3,dataY,unit,7)
right(xs[4]-4,dataY,str(int(o.get('qty') or 0)),7.1)
right(xs[5]-4,dataY,fmt(o.get('listPrice',o.get('unitPrice',0))),7)
right(xs[6]-3,dataY,str(o.get('discount',0))+'%',7)
right(xs[7]-3,dataY,fmt(o.get('unitPrice',0)),7)
right(xs[8]-4,dataY,fmt(o.get('subtotal',0)),7.1)
below=top-rowh*2-18

text(left,below,'THÔNG TIN THANH TOÁN',8.7,True,C_BLUE)
text(left,below-16,'Ngân hàng: KHÔNG ÁP DỤNG (SANDBOX)',7.4)
text(left,below-30,'Số tài khoản: Không hiển thị trong bản thử',7.4)
text(left,below-44,'Chủ tài khoản: HKD MINH SATORI',7.4)
text(left,below-58,'Nội dung: '+str(o['ref']),7.4)
# Do not expose production bank coordinates or QR: fake ordering sandbox.
tx=324;valueX=rightedge
right(valueX,below,fmt(o.get('subtotal',0)),8.1)
text(tx,below,'Tổng tiền hàng:',7.8)
text(tx,below-18,'Phí vận chuyển:',7.8)
right(valueX,below-18,fmt(o.get('shipping',0)),8.1)
text(tx,below-36,'Thuế VAT (0%):',7.8)
right(valueX,below-36,'0 đ',8.1)
c.setStrokeColor(C_BORDER);c.line(tx,below-42,valueX,below-42)
text(tx,below-57,'TỔNG THANH TOÁN',8.3,True)
right(valueX,below-57,fmt(o.get('total',0)),10.3,True,C_BLUE)

noteY=below-99
wrapped(left,noteY,'Số tiền bằng chữ: '+words(o.get('total',0)),515,8,leading=12)
text(left,noteY-43,'ĐẠI DIỆN BÊN BÁN',8.5,True)
text(left,noteY-56,'(Ký, ghi rõ họ tên)',7.2)
text(left+10,noteY-116,'HKD MINH SATORI',8,True,C_BLUE)
cx=W/2+80
text(cx,noteY-43,'ĐẠI DIỆN BÊN MUA / NGƯỜI NHẬN',8.3,True)
text(cx+30,noteY-56,'(Ký, ghi rõ họ tên)',7.2)
wrapped(cx+30,noteY-116,o.get('name','Khách thử'),180,8,True)

text(left,45,'SANDBOX — Phiếu thử nghiệm, không có giá trị thanh toán hoặc giao hàng.',7.3,True,C_GRAY)
right(rightedge,29,'1 / 1',7,C_GRAY)
c.showPage();c.save()
sys.stdout.buffer.write(buf.getvalue())
