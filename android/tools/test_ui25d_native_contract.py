"""UI-only regression checks; do not require Android SDK."""
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parents[1]
MAIN = (HERE / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text()
THEME = (HERE / "app/src/main/java/vn/minhsatori/app/SatoriUiTheme.kt").read_text()
WEB = (HERE.parent / "index.html").read_text()


class Ui25dContract(unittest.TestCase):
    def test_theme_selection_is_persistent_and_read_only(self):
        for phrase in ('minh_satori_ui25d', 'SatoriUiTheme.picker',
                       'SatoriUiTheme.soft', 'SatoriUiTheme.raised'):
            self.assertIn(phrase, MAIN + THEME)
        self.assertNotIn('MobileApiClient', THEME)
        self.assertNotIn('order.submit', THEME)

    def test_fold_drawer_hidden_and_opened_from_right(self):
        self.assertIn('FrameLayout.LayoutParams(drawerWidth, -1, Gravity.END)', MAIN)
        self.assertIn('translationX = drawerWidth.toFloat()', MAIN)
        self.assertIn('brand.addView(menuButton, LinearLayout.LayoutParams(dp(42), dp(46)))', MAIN)

    def test_protected_order_and_payment_entrypoints(self):
        for marker in ('renderV2OwnerBackend', 'renderInvoices', 'confirmSoftDelete',
                       'refreshFromMobileApi', 'launchEditor()'):
            self.assertIn(marker, MAIN)

    def test_ledger_uses_same_theme_without_touching_pdf(self):
        for marker in ('s25-ledger-controller', 's25-ledger-style',
                       'satori.ui.v25d', 's25-picker-trigger'):
            self.assertIn(marker, WEB)
        self.assertIn('id="invoicePreview"', WEB)


if __name__ == '__main__':
    unittest.main()
