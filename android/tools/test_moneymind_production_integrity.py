"""Android MoneyMind release: layout may change; accounting and write paths may not."""
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt').read_text(encoding='utf-8')
MANIFEST=(ROOT/'app/src/main/AndroidManifest.xml').read_text(encoding='utf-8')
PORTAL=(ROOT/'app/src/main/java/vn/minhsatori/app/AiCustomerPortalActivity.kt').read_text(encoding='utf-8')
BASELINE={
 'confirmInvoicePayment':'7c1541e5',
 'confirmSoftDelete':'6717c467',
 'executeWrite':'a513026e',
 'launchEditor':'a449a547',
 'recoverDriveAccessUsingOwnerApi':'4c0215f3',
 'openInvoice':'d6c87d15',
 'invoiceQuickCard':'b24c8011',
}
def method(name):
 token='    private fun '+name+'('
 i=SOURCE.index(token)
 import re
 m=re.search(r'\n    (?:private|override|public|internal) (?:fun|val|var) ',SOURCE[i+10:])
 return SOURCE[i:i+10+m.start()] if m else SOURCE[i:]
def checksum(s):
 h=0x811c9dc5
 for unit, in struct.iter_unpack('<H',s.encode('utf-16-le')):
  h=((h^unit)*0x01000193)&0xffffffff
 return f'{h:08x}'
class ProductionLayoutContract(unittest.TestCase):
 def test_financial_and_security_methods_unchanged_from_signed_v0416(self):
  for name,expected in BASELINE.items():
   with self.subTest(name=name):
    actual=method(name)
    if name=='openInvoice':
     # Only one explicit display-only section may differ from the signed
     # accounting/payment/PDF original. Strip exactly that section and require
     # the remaining source to retain the original signed method checksum.
     start='        // BEGIN_ACCOUNTING_PROFIT45_READ_ONLY\\n'
     end='        // END_ACCOUNTING_PROFIT45_READ_ONLY\\n'
     self.assertEqual(actual.count(start),1)
     self.assertEqual(actual.count(end),1)
     i=actual.index(start)
     j=actual.index(end,i)+len(end)
     added=actual[i:j]
     self.assertIn('AccountingProProfit45.invoice(',added)
     self.assertIn('Lãi hàng trước CTV/chi phí:',added)
     for forbidden in ('executeWrite(', 'confirmInvoicePayment(',
                       'launchEditor(', 'payments.mark', 'NativeInvoicePdf.preview(',
                       'setOnClickListener(', 'startActivity('):
      with self.subTest(forbidden=forbidden):
       self.assertNotIn(forbidden,added)
     actual=actual[:i]+actual[j:]
    self.assertEqual(checksum(actual),expected,
     'The signed payment, PDF and security method must remain byte-for-byte identical outside read-only profit label')
 def test_money_mind_native_routes_do_not_fake_invoices(self):
  for term in ('val bottomDestinations = listOf(', 'renderMoneyMindShortcuts(content)',
               'renderMoneyMindRecent(content, data)', 'renderMoneyMindOfflineState(content, activeTab)',
               'showAdvancedOverview','if (tabChanged && motionEnabled())'):
   self.assertIn(term,SOURCE)
  self.assertIn('if (data == null) "—"',SOURCE)
  self.assertIn('putExtra("mode", "admin")',SOURCE)
 def test_fold_gemini_and_keyboard_preserve_chat(self):
  self.assertIn('android:configChanges="screenSize|smallestScreenSize|orientation|screenLayout"',MANIFEST)
  self.assertIn('android:windowSoftInputMode="adjustResize"',MANIFEST)
  self.assertIn('override fun onConfigurationChanged(newConfig: Configuration)',PORTAL)
  self.assertIn('view.requestLayout()',PORTAL)
  self.assertNotIn('view.loadUrl(',PORTAL.split('override fun onConfigurationChanged(',1)[1].split('@Deprecated',1)[0])
 def test_user_samsung_round_square_logo(self):
  logo=SOURCE.split('val brandLogo = ImageView(this).apply {',1)[1].split('brand.addView(brandLogo',1)[0]
  self.assertIn('background = background(Color.WHITE, 12)',logo)
  self.assertNotIn('background = background(Color.WHITE, 19)',logo)
if __name__=='__main__': unittest.main()
