"""Regression: embedded owner CRM must visually match the native Satori app.

The CRM implementation stays inside the installed application. A verified
owner Google session precedes its WebView; no customer checkout URL or
separate standalone browser is allowed.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
PORTAL = (ROOT / "app/src/main/java/vn/minhsatori/app/AiCustomerPortalActivity.kt").read_text(encoding="utf-8")
MANIFEST = (ROOT / "app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")


class OwnerCrmVisualParity(unittest.TestCase):
    def test_native_palette_and_embedded_crm_match(self):
        # Primary teal (#009c99), ink (#102b38), soft background (#f1f4f5).
        self.assertIn("private val cyan = Color.rgb(0, 156, 153)", NATIVE)
        self.assertIn("private val ink = Color.rgb(16, 43, 56)", NATIVE)
        self.assertIn("private val night = Color.rgb(241, 244, 245)", NATIVE)
        self.assertIn("--blue:#009c99", PORTAL)
        self.assertIn("--ink:#102b38", PORTAL)
        self.assertIn("--bg:#f1f4f5", PORTAL)
        self.assertIn('background = pill(Color.WHITE, 17)', PORTAL)
        self.assertIn('setImageResource(R.drawable.ic_satori_users)', PORTAL)
        self.assertIn('R.drawable.ic_satori_user_plus', PORTAL)
        self.assertIn('quickLink("Khách cũ", R.drawable.ic_satori_users', PORTAL)
        self.assertIn('R.drawable.ic_satori_invoice', PORTAL)
        self.assertIn(".card { background:#fff!important", PORTAL)
        self.assertIn("button.danger {background:#fff1f3", PORTAL)

    def test_crm_first_hierarchy_and_consistent_mobile_fold_layout(self):
        self.assertIn("main>header, #ownerTabs { display:none!important; }", PORTAL)
        self.assertIn("#crmConsole { order:1; }", PORTAL)
        self.assertIn("#legacyConsole { order:2; }", PORTAL)
        self.assertIn("#console { order:3; }", PORTAL)
        self.assertIn('quickLink("Khách mới"', PORTAL)
        self.assertIn('quickLink("Khách cũ"', PORTAL)
        self.assertIn('activateOwnerTab(', PORTAL)
        self.assertIn('selectNativeTab(0)', PORTAL)
        self.assertIn('#ownerTabs { display:none!important; }', PORTAL)
        self.assertIn('quickLink("Danh mục"', PORTAL)
        self.assertIn("@media(max-width:560px)", PORTAL)
        self.assertIn("@media(min-width:700px)", PORTAL)
        self.assertIn("min-height:39px!important", PORTAL)
        self.assertIn("font-size:13.5px;line-height:1.42", PORTAL)
        self.assertIn('minimumHeight = dp(41)', PORTAL)
        self.assertIn('android:configChanges="screenSize|smallestScreenSize|orientation|screenLayout"', MANIFEST)
        self.assertIn('isFillViewport = true', PORTAL)

    def test_theme_is_only_applied_after_verified_owner_auth(self):
        self.assertIn('verifyOwnerSession(cookies)', PORTAL)
        self.assertIn('optBoolean("isAdmin") == true', PORTAL)
        self.assertIn('web.loadUrl(ORIGIN + "/owner-v2")', PORTAL)
        self.assertIn('location.pathname', PORTAL)
        self.assertIn("document.createElement('style')", PORTAL)
        self.assertIn("org.json.JSONObject.quote(css)", PORTAL)
        self.assertIn('url == ORIGIN + "/owner-v2/"', PORTAL)
        self.assertIn('applyNativeOwnerTheme()', PORTAL)
        self.assertIn('mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW', PORTAL)
        self.assertIn("CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)", PORTAL)
        self.assertNotIn("window.open(", PORTAL)
        self.assertNotIn("CustomTabsIntent.Builder()", PORTAL)
        self.assertIn("V2OwnerCrmActivity::class.java", NATIVE)

    def test_owner_phone_fold_controls_remain_horizontal(self):
        self.assertIn("#legacyConsole .crm-role-options {display:grid!important;", PORTAL)
        self.assertIn("grid-template-columns:repeat(3,minmax(0,1fr))!important;", PORTAL)
        self.assertIn("#legacyConsole .crm-card-footer {display:grid!important;", PORTAL)
        self.assertIn("#legacyConsole .crm-card-footer .crm-btn-primary {grid-column:auto!important;}", PORTAL)
        self.assertIn("#legacyConsole .crm-ctv-client-row {display:grid!important;", PORTAL)
        self.assertIn("#legacyConsole .crm-client-rate {display:flex!important;flex-flow:row nowrap!important;", PORTAL)
        self.assertIn("#legacyConsole .crm-client-rate .crm-client-save {display:inline-flex!important;", PORTAL)
        self.assertIn("#legacyConsole .crm-duplicate-picker {display:flex!important;flex-wrap:wrap!important;}", PORTAL)

    def test_original_finance_tabs_are_not_changed(self):
        for value in ("renderInvoices(content, data)", "renderDebt(content, data)",
                      "renderCustomers(content, data)", "confirmInvoicePayment",
                      "NativeInvoicePdf.preview(this, invoice)"):
            self.assertIn(value, NATIVE)


if __name__ == "__main__":
    unittest.main()
