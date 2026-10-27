"""Native-wide Satori visual-token regression; no real ledger access."""
from pathlib import Path
import unittest
BASE=Path(__file__).resolve().parents[1]
SRC=(BASE/"app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
DEBT=(BASE/"app/src/main/res/drawable/ic_satori_debt.xml").read_text(encoding="utf-8")

class SatoriReferenceStyleContract(unittest.TestCase):
    def test_dollar_banknote_icon_is_an_outline_vector(self):
        self.assertIn("<vector",DEBT)
        self.assertIn("M2.5,6.5 L21.5,6.5",DEBT)
        self.assertIn("M12,8.5 L12,15.5",DEBT)
        self.assertIn("android:fillColor=\"@android:color/transparent\"",DEBT)

    def test_stable_native_palette_and_cards(self):
        self.assertIn("private val night = Color.rgb(235, 241, 248)",SRC)
        self.assertIn("private val indigo = Color.rgb(217, 233, 250)",SRC)
        self.assertIn("setStroke(dp(1), Color.rgb(209, 222, 237))",SRC)
        self.assertIn("Color.rgb(228, 241, 255)",SRC)
        self.assertIn("Color.rgb(229, 246, 236)",SRC)
        self.assertIn("Color.rgb(255, 242, 222)",SRC)

    def test_dashboard_icons_replace_abstract_diamond_without_changing_actions(self):
        self.assertIn('iconRes: Int = R.drawable.ic_satori_invoice', SRC)
        self.assertIn('setImageResource(iconRes)', SRC)
        self.assertIn('background = panelBackground(tint, 17)', SRC)
        for token in ('R.drawable.ic_satori_invoice) {',
                      'R.drawable.ic_satori_users) {',
                      'R.drawable.ic_satori_debt) {',
                      'R.drawable.ic_satori_plus) {'):
            self.assertIn(token, SRC)
        self.assertNotIn('label(tile, "◆"', SRC)

    def test_no_business_navigation_or_financial_actions_removed(self):
        for token in ('R.drawable.ic_satori_debt to "Công nợ"',
                      'R.drawable.ic_satori_plus to "Lên đơn"',
                      'R.drawable.ic_satori_invoice to "Hóa đơn"',
                      'R.drawable.ic_satori_settings to "Quản trị hệ thống"',
                      'renderOverview(content, data)',
                      'renderInvoices(content, data)',
                      'renderCustomers(content, data)',
                      'renderDebt(content, data)',
                      'requestInvoiceEdit(invoice)',
                      'payments.markCustomerPaid',
                      'payments.markCustomerUnpaid',
                      'payments.markSatoriPaid',
                      'payments.markSatoriUnpaid'):
            self.assertIn(token,SRC)

if __name__=="__main__": unittest.main()
