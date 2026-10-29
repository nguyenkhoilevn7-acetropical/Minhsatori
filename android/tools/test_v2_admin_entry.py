"""Owner management must be a native page in Minh Satori, not a customer checkout page."""
import pathlib
import json
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
GRADLE = (ROOT / "app/build.gradle.kts").read_text(encoding="utf-8")
PORTAL = (ROOT / "app/src/main/java/vn/minhsatori/app/AiCustomerPortalActivity.kt").read_text(encoding="utf-8")
MANIFEST = (ROOT / "app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")

class V2AdminEntryContract(unittest.TestCase):
    def test_owner_backoffice_is_a_native_tab(self):
        self.assertIn('R.drawable.ic_satori_settings to "Quản trị hệ thống"', SOURCE)
        # The last native tab was visually renamed "Cá nhân", while the
        # secured V2 owner backend remains inside that same native destination.
        self.assertIn('val pages = listOf("Tổng quan", "Hóa đơn", "Khách hàng", "Công nợ", "Lên đơn", "Cá nhân")', SOURCE)
        self.assertIn('settingRow("Cài đặt kết nối"', SOURCE)
        self.assertIn('settingRow("Đồng bộ dữ liệu"', SOURCE)
        self.assertIn('settingRow("Trợ lý Gemini"', SOURCE)
        self.assertIn('5 -> renderV2OwnerBackend(content, data)', SOURCE)
        self.assertIn('if (activeTab == 5) {\n            renderV2OwnerBackend(content, data)', SOURCE)
        # The owner page is reached through the persistent MoneyMind bottom
        # navigation and via the unchanged advanced drawer.
        self.assertIn('Triple(5, "Cá nhân", R.drawable.ic_satori_settings)', SOURCE)
        self.assertIn('activeTab = index', SOURCE)
        self.assertIn('render()', SOURCE)
        self.assertIn('private fun renderV2OwnerBackend(parent: LinearLayout, current: SatoriSnapshot?)', SOURCE)

    def test_in_app_owner_crm_authenticates_with_native_google_before_webview(self):
        self.assertNotIn('/app-v2?view=account', SOURCE)
        self.assertNotIn('openV2Admin()', SOURCE)
        self.assertNotIn('CustomTabsIntent.Builder()', SOURCE)
        method = SOURCE.split('private fun renderV2OwnerBackend(', 1)[1].split('private fun renderOverview(', 1)[0]
        self.assertNotIn('WebView(', method, "Settings page must stay native")
        self.assertNotIn('SATORI_BOT_SECRET', method)
        self.assertIn('V2OwnerCrmActivity::class.java', method)
        self.assertIn('QUẢN LÝ KHÁCH HÀNG V2', method)
        self.assertIn('không dùng quyền Drive thay thế', method)
        self.assertIn('class V2OwnerCrmActivity', PORTAL)
        self.assertIn('android:name=".V2OwnerCrmActivity"', MANIFEST)
        self.assertIn('GetSignInWithGoogleOption.Builder(id)', PORTAL)
        self.assertIn('CredentialManager.create(this).getCredentialAsync(', PORTAL)
        self.assertIn('GoogleIdTokenCredential.createFrom(credential.data).idToken', PORTAL)
        self.assertNotIn('GoogleSignInClient', PORTAL)
        self.assertIn('verifyOwnerSession(cookies)', PORTAL)
        self.assertIn('optBoolean("isAdmin") == true', PORTAL)
        self.assertIn('"/api/v2/auth/google"', PORTAL)
        self.assertIn('"/api/v2/me"', PORTAL)
        self.assertIn('CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)', PORTAL)
        self.assertIn('javax.net.ssl.HttpsURLConnection', PORTAL)
        self.assertIn('onReceivedSslError(', PORTAL)
        self.assertIn('onJsConfirm(', PORTAL)
        self.assertNotIn('SATORI_BOT_SECRET', PORTAL)
        self.assertNotIn('CustomTabsIntent.Builder()', PORTAL)
        self.assertNotIn('WebView.setWebContentsDebuggingEnabled(true)', PORTAL)

    def test_existing_owner_invoice_and_customer_pages_remain_accessible(self):
        for pair in ['activeTab = 1','activeTab = 2','activeTab = 3','activeTab = 4']:
            self.assertIn(pair, SOURCE)
        self.assertIn('renderInvoices(content, data)', SOURCE)
        self.assertIn('renderCustomers(content, data)', SOURCE)
        self.assertIn('renderDebt(content, data)', SOURCE)

    def test_application_identity_preserved(self):
        self.assertIn('applicationId = "vn.minhsatori.app"', GRADLE)
        request = json.loads((ROOT / 'release-request.json').read_text())
        version_code = int(re.search(r'versionCode\s*=\s*(\d+)', GRADLE).group(1))
        version_name = re.search(r'versionName\s*=\s*"([^"]+)"', GRADLE).group(1)
        self.assertGreaterEqual(version_code, 27)
        self.assertEqual(version_code, request['versionCode'])
        self.assertEqual(version_name, request['version'])
        self.assertEqual(request['package'], 'vn.minhsatori.app')

if __name__ == '__main__':
    unittest.main()
