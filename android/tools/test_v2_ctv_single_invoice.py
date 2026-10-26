"""Static safety checks: CTV margins are private and never create two invoices."""
from pathlib import Path
import unittest
SRC=(Path(__file__).resolve().parents[1]/"app/src/main/java/vn/minhsatori/app/V2OwnerAdminActivity.kt").read_text(encoding="utf-8")
class CtvSingleInvoiceUi(unittest.TestCase):
    def test_only_single_mode_is_submitted(self):
        self.assertIn('.put("invoiceMode","single")',SRC)
        self.assertNotIn('.put("invoiceMode","pair")',SRC)
        self.assertNotIn('Field("mode","single / pair',SRC)
    def test_ctv_on_off_owner_controls(self):
        self.assertIn('Field("ctvMode","Tự tính lợi nhuận CTV: ON / OFF","OFF")',SRC)
        self.assertIn('data.put("collaboratorBps",ctv)',SRC)
        self.assertIn('require(ctv > customer)',SRC)
        self.assertIn('save("POST","/api/v2/admin/policies"',SRC)
    def test_private_summary_and_test_separation(self):
        self.assertIn('api.request("GET","/api/v2/admin/ctv-summary?profileId=$id")',SRC)
        self.assertIn('result.optLong("profitVnd")',SRC)
        self.assertIn('result.optLong("testProfitVnd")',SRC)
        self.assertIn('ĐƠN THỬ · KHÔNG GHI DOANH SỐ',SRC)
        self.assertIn('if (profileType == "collaborator")',SRC)
if __name__ == "__main__":
    unittest.main()
