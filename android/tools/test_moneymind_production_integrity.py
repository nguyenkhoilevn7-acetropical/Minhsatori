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
 'openInvoice':'cb0f31d3',
 'invoiceQuickCard':'88bb9544',
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
    self.assertEqual(checksum(method(name)),expected,'No financial method changes in layout release')
 def test_owner_card_edit_button_is_direct_and_still_server_guarded(self):
  method_text=method('invoiceQuickCard')
  self.assertIn('requestInvoiceEdit(invoice)',method_text)
  self.assertIn('confirmSoftDelete(invoice)',method_text)
  self.assertIn('openInvoice(invoice)',method_text)
  edit=method('requestInvoiceEdit')
  self.assertIn('canAction("orders.update")',edit)
  self.assertIn('AccountingProReadOnly.invoiceRows(data.invoices)',edit)
  self.assertIn('latest.canEditOrDelete',edit)
  self.assertIn('latest != original',edit)
  self.assertIn('launchEditor(editing = latest)',edit)
  self.assertNotIn('executeWrite(',edit)
  self.assertNotIn('MobileApiClient.request(',edit)

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
