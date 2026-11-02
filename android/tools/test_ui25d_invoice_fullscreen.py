"""Full-screen invoice UI contract: every caller shares one detail route."""
import pathlib
import re
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
KT=(ROOT/"app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
ICON=(ROOT/"app/src/main/res/drawable/ic_satori_profit.xml").read_text(encoding="utf-8")
DETAIL=KT.split("    private fun openInvoice(invoice: SatoriInvoice) {",1)[1].split("\n    private fun configureMobileApi() {",1)[0]
HOME=KT.split("    private fun renderUi25dHome(",1)[1].split("    private fun renderUi25dSectionIntro(",1)[0]

class FullscreenInvoiceContract(unittest.TestCase):
    def test_kpi_icons_are_vector_assets_not_unrenderable_text_glyphs(self):
        self.assertIn("val smallIcon = ImageView(this).apply {",HOME)
        self.assertIn("setImageResource(iconRes)",HOME)
        self.assertIn("R.drawable.ic_satori_invoice, 1)",HOME)
        self.assertIn("R.drawable.ic_satori_debt, 3)",HOME)
        self.assertIn("R.drawable.ic_satori_profit, 0)",HOME)
        self.assertIn('android:pathData="M5,16 L10,11 L14,14 L20,7"',ICON)
        for bad in ('text = icon','tealAccent, "▥"','"▣"','"▤"'):
            self.assertNotIn(bad,HOME)

    def test_invoice_opens_fullscreen_not_narrow_modal(self):
        for marker in (
            "val stickyHeader = LinearLayout(this)",
            "val closePage = ImageView(this)",
            'contentDescription = "Đóng chi tiết hóa đơn"',
            "invoiceDialog?.dismiss()",
            "val expanded = resources.configuration.screenWidthDp >= 600",
            "if (expanded) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL",
            "val customerBlock = LinearLayout(this)",
            "val productBlock = LinearLayout(this)",
            "content.addView(detailGrid",
            "dialog.setCanceledOnTouchOutside(false)",
            "setView(page)",
            "resizeInvoiceDialog(dialog)",
        ):
            with self.subTest(marker=marker): self.assertIn(marker,DETAIL)
        self.assertIn("android.view.WindowManager.LayoutParams.MATCH_PARENT",KT)
        self.assertNotIn(".setView(wrapper)",DETAIL)
        self.assertNotIn('.setPositiveButton("Chia sẻ", null)',DETAIL)
        self.assertNotIn('.setNegativeButton("Đóng", null)\n            .setPositiveButton("Chia sẻ"',DETAIL)

    def test_all_invoice_entrypoints_still_call_one_method(self):
        self.assertGreaterEqual(len(re.findall(r'openInvoice\(invoice\)',KT)),4)
        self.assertEqual(KT.count("    private fun openInvoice(invoice: SatoriInvoice) {"),1)
        for marker in ("NativeInvoicePdf.preview(this, invoice)",
                       "NativeInvoicePdf.shareZalo(this, invoice)",
                       "NativeInvoicePdf.shareMessenger(this, invoice)",
                       'invoicePaymentRow(content, "Khách hàng"',
                       'invoicePaymentRow(content, "Satori"',
                       "confirmSoftDelete(invoice)",
                       "requestInvoiceEdit(invoice)"):
            with self.subTest(marker=marker): self.assertIn(marker,DETAIL)

if __name__ == "__main__": unittest.main()
