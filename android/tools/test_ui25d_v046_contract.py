"""Presentation-only v0.4.46 regression checks. No network, Drive, or real invoice mutation."""
import json
import pathlib
import unittest

ANDROID = pathlib.Path(__file__).resolve().parents[1]
ROOT = ANDROID / "app/src/main/java/vn/minhsatori/app"
ACTIVITY = (ROOT / "NativeMainActivity.kt").read_text(encoding="utf-8")
THEME = (ROOT / "SatoriUiTheme.kt").read_text(encoding="utf-8")
GRADLE = (ANDROID / "app/build.gradle.kts").read_text(encoding="utf-8")
RELEASE = json.loads((ANDROID / "release-request.json").read_text(encoding="utf-8"))


class Ui25dNativeV046(unittest.TestCase):
    def test_latest_release_identity_not_downgraded(self):
        self.assertIn('versionCode = 63', GRADLE)
        self.assertIn('versionName = "0.4.46"', GRADLE)
        self.assertEqual(RELEASE['versionCode'], 63)
        self.assertEqual(RELEASE['version'], '0.4.46')
        self.assertEqual(RELEASE['package'], 'vn.minhsatori.app')

    def test_native_palette_controls_are_persistent_and_readonly(self):
        for marker in ('SatoriUiTheme.accent(this)', 'SatoriUiTheme.raised(this)',
                       'SatoriUiTheme.picker', 'SatoriUiTheme.soft'):
            self.assertIn(marker, ACTIVITY)
        for marker in ('minh_satori_ui25d', 'SharedPreferences',
                       'putString(COLOR', 'putBoolean(DEPTH'):
            self.assertIn(marker, THEME)
        for secret in ('MobileApiClient', 'SATORI_READ_HMAC_SECRET', 'orders.create', 'orders.delete'):
            self.assertNotIn(secret, THEME)

    def test_fold_drawer_keeps_original_right_collapsed_semantics(self):
        for marker in ('FrameLayout.LayoutParams(drawerWidth, -1, Gravity.END)',
                       'translationX = drawerWidth.toFloat()', 'menuButton.setOnClickListener { showDrawer() }',
                       'scrim.setOnClickListener { dismissDrawer() }',
                       'val bottomDestinations = listOf(', 'Triple(5, "Cá nhân"'):
            self.assertIn(marker, ACTIVITY)
        self.assertNotIn('shell.addView(tabs)', ACTIVITY)

    def test_critical_owner_operations_are_untouched(self):
        for marker in ('openPendingNotificationInvoiceIfReady()',
                       'V2RegistrationAlerts.pendingCount(this)',
                       'highlightMoneyInView(content)', 'confirmSoftDelete(invoice)',
                       'invoice.displayPayable', 'renderV2OwnerBackend', 'fun refreshNow('):
            self.assertIn(marker, ACTIVITY)


if __name__ == '__main__':
    unittest.main()
