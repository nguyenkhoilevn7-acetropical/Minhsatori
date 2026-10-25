"""Offline checks: owner-facing V2 action never embeds privileges or secrets."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
GRADLE = (ROOT / "app/build.gradle.kts").read_text(encoding="utf-8")


class V2AdminEntryContract(unittest.TestCase):
    def test_owner_v2_menu_reachable_from_native_app(self):
        self.assertIn('"⚙" to "Quản trị V2"', SOURCE)
        self.assertIn('if (item.second == "Quản trị V2") openV2Admin()', SOURCE)
        self.assertIn('QUẢN TRỊ MINH SATORI V2 • KHÁCH HÀNG / ĐẠI LÝ', SOURCE)

    def test_google_auth_uses_secure_browser_not_embedded_webview(self):
        method = SOURCE.split("private fun openV2Admin()", 1)[1].split(
            "private fun renderOverview(", 1)[0]
        self.assertIn('https://minh-satori-v2-customer-admin.onrender.com/app-v2?view=account', method)
        self.assertIn('CustomTabsIntent.Builder()', method)
        self.assertIn('Intent.ACTION_VIEW', method)
        self.assertNotIn('WebView(', method)
        self.assertNotIn('SATORI_BOT_SECRET', method)
        self.assertNotIn('ownerGoogleSub', method)

    def test_android_package_and_release_identity_remain_stable(self):
        self.assertIn('applicationId = "vn.minhsatori.app"', GRADLE)
        self.assertIn('implementation("androidx.browser:browser:1.8.0")', GRADLE)
        self.assertIn('versionCode = 26', GRADLE)
        self.assertIn('versionName = "0.4.9"', GRADLE)


if __name__ == "__main__":
    unittest.main()
