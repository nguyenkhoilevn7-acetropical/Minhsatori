"""Synthetic UI-only checks for compact Android invoice detail.

No production invoice, Google token, payment or customer data is accessed.
"""
from pathlib import Path
import unittest

ANDROID = Path(__file__).resolve().parents[1]
SRC = (ANDROID / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
DETAIL = SRC.split("private fun openInvoice(", 1)[1].split("private fun configureMobileApi(", 1)[0]
DRAWABLE = ANDROID / "app/src/main/res/drawable"


class CompactInvoiceDetailContract(unittest.TestCase):
    def test_two_payment_facts_remain_independent_and_visible(self):
        self.assertIn('invoicePaymentRow(content, "Khách", invoice.customerHasPaid', DETAIL)
        self.assertIn('invoicePaymentRow(content, "Satori", invoice.satoriHasPaid', DETAIL)
        self.assertIn('payments.markCustomerPaid', DETAIL)
        self.assertIn('payments.markCustomerUnpaid', DETAIL)
        self.assertIn('payments.markSatoriPaid', DETAIL)
        self.assertIn('payments.markSatoriUnpaid', DETAIL)
        self.assertIn('if (!canAction(action))', DETAIL)
        self.assertIn('confirmInvoicePayment(invoice, action)', DETAIL)
        self.assertIn('val canEditPayment = validInvoiceNumber != null && invoice.canChangePayment', DETAIL)

    def test_compact_toolbar_branded_icons_not_long_button_labels(self):
        self.assertIn('invoiceMiniAction(actions, R.drawable.ic_satori_edit', DETAIL)
        self.assertIn('invoiceMiniAction(actions, R.drawable.ic_satori_trash', DETAIL)
        self.assertIn('invoiceMiniAction(actions, R.drawable.ic_brand_zalo', DETAIL)
        self.assertIn('invoiceMiniAction(actions, R.drawable.ic_brand_messenger', DETAIL)
        self.assertNotIn('button(content, "GỬI PDF QUA ZALO"', DETAIL)
        self.assertNotIn('button(content, "GỬI PDF QUA MESSENGER"', DETAIL)
        self.assertNotIn('button(content, "XÓA ĐƠN • THÙNG RÁC 30 NGÀY"', DETAIL)
        self.assertNotIn('Nút đã hiển thị để kiểm tra giao diện', DETAIL)

    def test_no_pdf_or_security_regression(self):
        self.assertIn('NativeInvoicePdf.preview(this, invoice)', DETAIL)
        self.assertIn('NativeInvoicePdf.shareZalo(this, invoice)', DETAIL)
        self.assertIn('NativeInvoicePdf.shareMessenger(this, invoice)', DETAIL)
        self.assertIn('NativeInvoicePdf.share(this, invoice)', DETAIL)
        self.assertIn('confirmInternalShare {', DETAIL)
        self.assertIn('confirmSoftDelete(invoice)', DETAIL)
        self.assertIn('if (!canAction("orders.update"))', DETAIL)
        self.assertIn('requestInvoiceEdit(invoice)', DETAIL)
        self.assertIn('.setPositiveButton("Chia sẻ", null)', DETAIL)

    def test_accessibility_and_vector_brand_sources(self):
        helper = SRC.split("private fun invoiceMiniAction(", 1)[1].split(
            "private fun invoicePaymentRow(", 1)[0]
        self.assertIn('contentDescription = title', helper)
        self.assertIn('tooltipText = title', helper)
        self.assertIn('setOnClickListener { click() }', helper)
        self.assertIn('LinearLayout.LayoutParams(dp(48), dp(48))', helper)
        self.assertNotIn('LayoutParams(0, dp(51), 1f)', helper)
        self.assertNotIn('shareWidth =', helper)
        self.assertIn('if (parent.childCount == 0) 0 else dp(7)', helper)
        for name in ("zalo", "messenger"):
            vector = (DRAWABLE / f"ic_brand_{name}.xml").read_text(encoding="utf-8")
            self.assertIn('<vector', vector)
            self.assertIn('android:pathData=', vector)
            self.assertIn('android:fillColor="#FFFFFFFF"', vector)

    def test_fold_cover_and_inner_display_layout(self):
        helper = SRC.split("private fun resizeInvoiceDialog(", 1)[1].split(
            "private fun invoicePaymentRow(", 1)[0]
        self.assertIn("viewportWidth - 24", helper)
        self.assertIn(".coerceAtMost(540)", helper)
        self.assertIn("dialog.window?.setLayout(dp(safeWidth), usableHeight)", helper)
        self.assertIn("activeInvoiceDialog?.takeIf { it.isShowing }?.let(::resizeInvoiceDialog)", SRC)
        self.assertIn("if (resources.configuration.screenWidthDp >= 420)", DETAIL)
        self.assertIn('toolbar.addView(actions, LinearLayout.LayoutParams(-2, -2))', DETAIL)
        self.assertIn('actions.gravity = Gravity.CENTER', DETAIL)
        self.assertIn("resizeInvoiceDialog(dialog)", DETAIL)

    def test_zalo_vector_uses_android_safe_polygon_not_svg_arc_flags(self):
        import re
        from xml.etree import ElementTree as ET
        path = DRAWABLE / "ic_brand_zalo.xml"
        root = ET.fromstring(path.read_text(encoding="utf-8"))
        name = "{http://schemas.android.com/apk/res/android}"
        paths = root.findall("path")
        self.assertEqual(len(paths), 1)
        data = paths[0].attrib.get(name + "pathData", "")
        self.assertGreater(data.count("L"), 70)
        self.assertEqual(paths[0].attrib.get(name + "fillType"), "evenOdd")
        self.assertNotRegex(data, r"[Aa]")  # no ambiguous SVG arc syntax


if __name__ == "__main__":
    unittest.main()
