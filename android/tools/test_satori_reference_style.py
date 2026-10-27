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
        self.assertIn("private val night = Color.rgb(241, 244, 245)",SRC)
        self.assertIn("private val indigo = Color.rgb(226, 246, 243)",SRC)
        self.assertIn("setStroke(dp(1), Color.rgb(225, 233, 233))",SRC)
        self.assertIn("Color.rgb(226, 247, 244)",SRC)
        self.assertIn("Color.rgb(227, 247, 238)",SRC)
        self.assertIn("Color.rgb(255, 246, 223)",SRC)

    def test_dashboard_text_contrast_and_owner_gemini_mode(self):
        self.assertIn('background = panelBackground(teal, 19)', SRC)
        self.assertIn('setTextColor(Color.WHITE)', SRC)
        self.assertIn('setTextColor(Color.rgb(226, 255, 249))', SRC)
        self.assertIn('putExtra("mode", "admin")', SRC)
        self.assertNotIn('12f, false, Color.rgb(202, 239, 249), 7)', SRC)

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

    def test_money_mind_flat_teal_without_gradient(self):
        self.assertIn('private val cyan = Color.rgb(0, 156, 153)', SRC)
        self.assertIn('setColor(Color.rgb(0, 156, 153))', SRC)
        self.assertIn('background = panelBackground(Color.WHITE, 18)', SRC)
        self.assertIn('background = panelBackground(Color.rgb(230, 248, 243), 18)', SRC)
        self.assertNotIn('Color.rgb(66, 151, 255)', SRC)

    def test_invoice_card_shows_both_payment_statuses_without_new_write_paths(self):
        card = SRC.split("private fun invoiceQuickCard(", 1)[1].split(
            "private fun requestInvoiceEdit(", 1)[0]
        for token in (
            "invoice.customerHasPaid", "invoice.satoriHasPaid",
            "Khách đã thanh toán", "Khách chưa thanh toán",
            "Đã thanh toán Satori", "Chưa thanh toán Satori",
            "SatoriData.money(invoice.total)", "invoice.displayDate",
            "requestInvoiceEdit(invoice)", "confirmSoftDelete(invoice)",
            "openInvoice(invoice)",
        ):
            self.assertIn(token, card)
        self.assertNotIn("confirmInvoicePayment(", card)

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
