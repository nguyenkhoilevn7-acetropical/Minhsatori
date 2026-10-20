"""Isolated, non-payable QR image for one Minh Satori sandbox order."""
import io
import json
import sys
import qrcode

order=json.load(sys.stdin)
ref=str(order.get('ref',''))
if not order.get('sandbox') or not ref.startswith('TEST-'):
    raise SystemExit('Only TEST orders can have sandbox QR codes')
amount=int(round(float(order.get('total',0))))
if amount<0:
    raise SystemExit('Invalid sandbox amount')
# The same per-bill QR payload used by invoice_pdf.py; it is NOT a bank/VietQR transfer.
payload='MINH-SATORI|SANDBOX|REF='+ref+'|TOTAL-VND='+str(amount)
code=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=6,border=3)
code.add_data(payload)
code.make(fit=True)
image=code.make_image(fill_color='black',back_color='white')
output=io.BytesIO()
image.save(output,format='PNG')
sys.stdout.buffer.write(output.getvalue())
