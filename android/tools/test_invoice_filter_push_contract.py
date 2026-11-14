"""Sandbox source contracts for invoice cards, filters and owner push readiness."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
SRC=(ROOT/"app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text()
DETAIL=SRC.split("private fun renderInvoices(",1)[1].split("private fun customerInfoRow(",1)[0]
PUSH=(ROOT/"app/src/main/java/vn/minhsatori/app/SatoriFirebasePush.kt").read_text()
MANIFEST=(ROOT/"app/src/main/AndroidManifest.xml").read_text()

class OwnerPushFilterTests(unittest.TestCase):
 def test_invoice_kpis_equal_height_and_short_title(self):
  self.assertIn('label(salesSummary, "TỔNG TIỀN BÁN"',DETAIL)
  self.assertNotIn('TỔNG TIỀN BÁN · HÓA ĐƠN HỢP LỆ',DETAIL)
  self.assertIn('salesRow.addView(salesSummary, LinearLayout.LayoutParams(0, dp(110), 1f)',DETAIL)
  self.assertIn('salesRow.addView(countSummary, LinearLayout.LayoutParams(0, dp(110), 1f)',DETAIL)
  self.assertIn('fitCardNumber(salesAmount)',DETAIL)
  self.assertIn('fitCardNumber(invoiceCount)',DETAIL)
  self.assertNotIn('salesAmount.setSingleLine(true)',DETAIL)
 def test_chips_directly_filter_and_count(self):
  self.assertIn('selectedInvoiceStatusIndex = index',DETAIL)
  self.assertIn('refreshList()',DETAIL)
  self.assertIn('InvoiceScreenFilter.apply(',DETAIL)
  self.assertIn('Tìm thấy ',DETAIL)
  self.assertNotIn('filter.setSelection(index)',DETAIL)
  self.assertIn('SatoriData.search(it, query)',(ROOT/"app/src/main/java/vn/minhsatori/app/InvoiceScreenFilter.kt").read_text())
 def test_background_push_never_exposes_customer_data_or_financial_writes(self):
  self.assertIn('FirebaseMessagingService()',PUSH)
  self.assertIn('message.data["type"] != "verified_new_invoice"',PUSH)
  self.assertIn('message.data["invoiceNo"]',PUSH)
  self.assertIn('V2RegistrationAlerts.cookie()',PUSH)
  self.assertIn('"X-Satori-CSRF"',PUSH)
  self.assertIn('!configured()',PUSH)
  self.assertIn('NativeMainActivity::class.java',PUSH)
  self.assertNotIn('"amount"',PUSH)
  self.assertIn('com.google.firebase.MESSAGING_EVENT',MANIFEST)
  self.assertIn('SatoriPush.registerOwnerDevice(this)',SRC)

if __name__=="__main__":
 unittest.main()
