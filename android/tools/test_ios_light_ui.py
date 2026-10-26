"""Read-only regression checks for the owner Android iOS light visual release.

They inspect source and never access Google Drive, credentials or invoices.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
ACTIVITY = ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt"
GRADLE = ROOT / "app/build.gradle.kts"


class IOSLightThemeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = ACTIVITY.read_text(encoding="utf-8")
        cls.gradle = GRADLE.read_text(encoding="utf-8")

    def test_release_is_newer_than_existing_owner_app(self):
        version_name = re.search(r'versionName = "(\d+)\.(\d+)\.(\d+)"', self.gradle)
        version_code = re.search(r'versionCode = (\d+)', self.gradle)
        self.assertIsNotNone(version_name)
        self.assertIsNotNone(version_code)
        self.assertGreaterEqual(tuple(int(x) for x in version_name.groups()), (0, 4, 8))
        self.assertGreaterEqual(int(version_code.group(1)), 25)
        self.assertIn('applicationId = "vn.minhsatori.app"', self.gradle)

    def test_ios_light_palette_is_not_dark_legacy(self):
        self.assertIn("private val night = Color.rgb(242, 242, 247)", self.source)
        self.assertIn("private val surface = Color.rgb(255, 255, 255)", self.source)
        self.assertIn("private val cyan = Color.rgb(0, 122, 255)", self.source)
        self.assertIn("private val ink = Color.rgb(28, 28, 30)", self.source)
        self.assertIn("white, dark -> ink", self.source)
        self.assertIn("Color.rgb(227, 229, 234)", self.source)

    def test_existing_live_capabilities_still_present(self):
        for text in ("fun invoiceQuickCard(", "fun customerQuickCard(", 
                     "fun confirmSoftDelete(", "fun renderInvoices(",
                     "fun renderCustomers(", "fun renderDebt(", 
                     "NativeInvoicePdf.preview", "NativeInvoicePdf.shareZalo",
                     "NativeInvoicePdf.shareMessenger", "fun refreshNow("):
            with self.subTest(text=text):
                self.assertIn(text, self.source)
        self.assertIn('canAction("orders.delete")', self.source)
        self.assertIn('val destinations = listOf(', self.source)
        self.assertIn('menuButton.setOnClickListener { showDrawer() }', self.source)
        self.assertIn('dismissDrawer {', self.source)
        self.assertIn('activeTab = index', self.source)
        self.assertIn('5 -> renderV2OwnerBackend(content, data)', self.source)
        self.assertNotIn('openV2Admin()', self.source)
        self.assertIn('drawer.animate().translationX(0f).setDuration(260)', self.source)
        self.assertIn('scrim.setOnClickListener { dismissDrawer() }', self.source)
        self.assertNotIn('shell.addView(tabs)', self.source)

    def test_no_inline_delete_without_owner_gate(self):
        card = self.source.split("private fun invoiceQuickCard(", 1)[1].split(
            "private fun confirmSoftDelete(", 1)[0]
        self.assertIn("invoice.canEditOrDelete", card)
        self.assertIn('canAction("orders.delete")', card)
        self.assertIn("confirmSoftDelete(invoice)", card)


if __name__ == "__main__":
    unittest.main()
