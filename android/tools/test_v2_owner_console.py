"""Read-only V2 Android owner-console contracts. No network and no real ledger changes."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
ANDROID=ROOT/"app/src/main/java/vn/minhsatori/app"
MAIN=(ANDROID/"NativeMainActivity.kt").read_text(encoding="utf-8")
OWNER=(ANDROID/"V2OwnerAdminActivity.kt").read_text(encoding="utf-8")
API=(ANDROID/"V2OwnerApi.kt").read_text(encoding="utf-8")
MANIFEST=(ROOT/"app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")

class NativeV2OwnerConsole(unittest.TestCase):
    def test_native_isolated_entry(self):
        self.assertIn('V2OwnerAdminActivity::class.java',MAIN)
        self.assertIn('android:name=".V2OwnerAdminActivity" android:exported="false"',MANIFEST)
        self.assertNotIn('WebView(',OWNER)
        self.assertNotIn('CustomTabsIntent',OWNER)
        self.assertNotIn('SATORI_BOT_SECRET',OWNER)
        self.assertNotIn('/app-v2?preview=1',OWNER)

    def test_google_verified_owner_not_drive_token(self):
        self.assertIn('CredentialManager.create(this)',OWNER)
        self.assertIn('GetSignInWithGoogleOption.Builder(clientId)',OWNER)
        self.assertIn('GoogleIdTokenCredential.createFrom(credential.data).idToken',OWNER)
        self.assertIn('api.ownerLogin(idToken)',OWNER)
        self.assertIn('account.optBoolean("isAdmin", false)',API)
        self.assertIn('fun clear() { session = null; csrf = null }',API)
        self.assertIn('requiresAuth: Boolean = true',API)
        self.assertIn('if (requiresAuth && !authenticated)',API)
        self.assertIn('connection.setRequestProperty("X-Satori-CSRF", csrf)',API)
        self.assertIn('connection.setRequestProperty("Origin", ORIGIN)',API)
        self.assertIn('connection.instanceFollowRedirects = false',API)
        self.assertIn('https://minh-satori-v2-customer-admin.onrender.com',API)
        for forbidden in ('SATORI_BOT_SECRET','SATORI_READ_HMAC_SECRET','SharedPreferences',
                          'setJavaScriptEnabled','http://'):
            self.assertNotIn(forbidden,API)

    def test_full_crm_modules_are_server_owned(self):
        for endpoint in (
            '/api/v2/admin/customers',
            '/api/v2/admin/customers/details',
            '/api/v2/admin/customer-leads',
            '/api/v2/admin/profiles',
            '/api/v2/admin/addresses',
            '/api/v2/admin/policies',
            '/api/v2/admin/catalogue/refresh',
            '/api/v2/catalogue',
            '/api/v2/orders',
        ):
            self.assertIn(endpoint,OWNER)
        self.assertIn('discountBps',OWNER)
        self.assertIn('collaboratorBps',OWNER)
        self.assertIn('OWNER',OWNER.upper())
        self.assertIn('expectedRevision',OWNER)
        self.assertIn('confirmed",true',OWNER)
        self.assertIn('Lưu trữ hồ sơ',OWNER)
        self.assertIn('Không sao chép hoặc tự tạo lại hóa đơn',OWNER)

    def test_owner_ctv_toggle_requires_real_backend_eligibility(self):
        # Not a client-side authorization decision: backend verifies immutable
        # Google owner sub, ACTIVE account, collaborator profile and revision.
        self.assertIn('item.optBoolean("hasCtvProfile", false)', OWNER)
        self.assertIn('item.optBoolean("ctvEnabled", false)', OWNER)
        self.assertIn('active == "ACTIVE"', OWNER)
        self.assertIn('"/api/v2/admin/ctv-mode"', OWNER)
        self.assertIn('.put("expectedRevision",item.getInt("revision"))', OWNER)
        self.assertIn('.put("enabled",nextEnabled).put("confirmed",true)', OWNER)
        self.assertIn('Không thay đổi hoa hồng, hóa đơn đã phát hành', OWNER)
        self.assertIn('save("PATCH","/api/v2/admin/ctv-mode",data) { fetchCustomers() }', OWNER)

    def test_original_pdf_download_contract_is_single_source_and_verified(self):
        original=(ANDROID/"V2CanonicalInvoicePdf.kt").read_text(encoding="utf-8")
        for required in (
            "/api/v2/invoice-document?id=",
            "application/pdf",
            "X-Content-SHA256",
            "MessageDigest.getInstance(\"SHA-256\")",
            "computed == expectedSha256",
            "connection.instanceFollowRedirects = false",
            "MAX_BYTES",
            "connection.disconnect()",
            "context.cacheDir",
        ):
            self.assertIn(required,original)
        self.assertNotIn("PdfDocument(",original)
        self.assertNotIn("WebsiteInvoicePdf.render",original)
        self.assertNotIn("SharedPreferences",original)
        self.assertIn('fun invoiceHistory(): JSONObject',API)
        self.assertIn('fun invoiceDetails(bindingId: String)',API)
        self.assertIn('fun originalInvoicePdfBytes(invoiceId: String, expectedSha256: String)',API)
        self.assertIn("V2CanonicalInvoicePdf.download",API)

    def test_previous_main_ledger_still_available(self):
        for old in ('renderInvoices(content, data)','renderCustomers(content, data)',
                    'renderDebt(content, data)','renderNewOrderInfo(content)'):
            self.assertIn(old, MAIN)

if __name__=="__main__":
    unittest.main()
