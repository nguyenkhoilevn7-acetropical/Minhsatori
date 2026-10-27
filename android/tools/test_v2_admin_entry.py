"""Owner management must be a native page in Minh Satori, not a customer checkout page."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
GRADLE = (ROOT / "app/build.gradle.kts").read_text(encoding="utf-8")

class V2AdminEntryContract(unittest.TestCase):
    def test_owner_backoffice_is_a_native_tab(self):
        self.assertIn('R.drawable.ic_satori_settings to "Quản trị hệ thống"', SOURCE)
        self.assertIn('val pages = listOf("Tổng quan", "Hóa đơn", "Khách hàng", "Công nợ", "Lên đơn", "Quản trị hệ thống")', SOURCE)
        self.assertIn('5 -> renderV2OwnerBackend(content, data)', SOURCE)
        self.assertIn('if (activeTab == 5) {\n            renderV2OwnerBackend(content, data)', SOURCE)
        self.assertIn('activeTab = 5\n                render()', SOURCE)
        self.assertIn('private fun renderV2OwnerBackend(parent: LinearLayout, current: SatoriSnapshot?)', SOURCE)

    def test_no_admin_navigation_to_customer_site_or_embedded_browser(self):
        self.assertNotIn('/app-v2?view=account', SOURCE)
        self.assertNotIn('openV2Admin()', SOURCE)
        self.assertNotIn('CustomTabsIntent.Builder()', SOURCE)
        method=SOURCE.split('private fun renderV2OwnerBackend(',1)[1].split('private fun renderOverview(',1)[0]
        self.assertNotIn('WebView(', method)
        self.assertNotIn('SATORI_BOT_SECRET', method)
        self.assertIn('Google OAuth V2 chưa xác minh chủ tài khoản', method)
        self.assertIn('Không tự động lấy quyền Admin từ đăng nhập Drive', method)

    def test_existing_owner_invoice_and_customer_pages_remain_accessible(self):
        for pair in ['activeTab = 1','activeTab = 2','activeTab = 3','activeTab = 4']:
            self.assertIn(pair, SOURCE)
        self.assertIn('renderInvoices(content, data)', SOURCE)
        self.assertIn('renderCustomers(content, data)', SOURCE)
        self.assertIn('renderDebt(content, data)', SOURCE)

    def test_application_identity_preserved(self):
        self.assertIn('applicationId = "vn.minhsatori.app"', GRADLE)
        self.assertIn('versionCode = 27', GRADLE)
        self.assertIn('versionName = "0.4.10"', GRADLE)

if __name__ == '__main__':
    unittest.main()
