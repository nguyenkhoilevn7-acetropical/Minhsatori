"""PDF for FAKE SANDBOX orders only. Uses system-installed fonts; never distributes font files."""
import sys, json, io, os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4

order=json.load(sys.stdin)
if not order.get('sandbox') or not str(order.get('ref','')).startswith('TEST-'):
    raise SystemExit('Production invoices are not accepted by the sandbox PDF generator')
fonts=[os.environ.get('PDF_FONT_PATH',''),'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf']
font=next((p for p in fonts if p and os.path.isfile(p)),None)
if not font:
    raise SystemExit('No Unicode font installed: provide PDF_FONT_PATH')
pdfmetrics.registerFont(TTFont('SandboxUnicode',font))
stream=io.BytesIO()
c=canvas.Canvas(stream,pagesize=A4,pageCompression=1)
w,h=A4
c.setFont('SandboxUnicode',17);c.drawString(38,h-55,'MINH SATORI — PHIẾU ĐƠN THỬ')
c.setFont('SandboxUnicode',10)
rows=[
 'SANDBOX — KHÔNG CÓ GIÁ TRỊ THANH TOÁN / GIAO HÀNG',
 'Mã đơn: '+order['ref'],
 'Khách: '+order['name'],
 'SĐT: '+order['phone'],
 'Địa chỉ: '+order['address'],
 'Sản phẩm: '+order['product'],
 'Số lượng: '+str(order['qty'])+' thùng',
 'Chiết khấu: '+str(order['discount'])+'%',
 'Đơn giá: '+f"{order['unitPrice']:,}"+' VND',
 'Tiền hàng: '+f"{order['subtotal']:,}"+' VND',
 'Phí vận chuyển: '+f"{order['shipping']:,}"+' VND',
 'TỔNG: '+f"{order['total']:,}"+' VND',
 'Trạng thái: Chờ thanh toán',
 'Đây là phiếu thử nghiệm, không được phát hành cho khách thật.'
]
y=h-97
for line in rows:
 c.drawString(38,y,line[:110]);y-=29 if line.startswith('TỔNG') else 25
c.setFont('SandboxUnicode',39);c.setFillColorRGB(.83,.85,.88);c.saveState();c.translate(150,200);c.rotate(28);c.drawString(0,0,'SANDBOX');c.restoreState()
c.save()
sys.stdout.buffer.write(stream.getvalue())