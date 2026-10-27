"""Non-regression contract for the Android customer identity presentation.

This suite checks source structure; rendered device acceptance is separate.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
ICONS = ROOT / "app/src/main/res/drawable"


class CustomerCardContract(unittest.TestCase):
    def test_customer_cards_have_outline_identity_phone_and_address(self):
        block = SRC.split("private fun customerQuickCard(", 1)[1].split("private fun renderCustomers(", 1)[0]
        self.assertIn("R.drawable.ic_satori_users", block)
        self.assertIn("R.drawable.ic_satori_phone", block)
        self.assertIn("R.drawable.ic_satori_map_pin", block)
        self.assertIn('"SỐ ĐIỆN THOẠI"', block)
        self.assertIn('"ĐỊA CHỈ GIAO HÀNG"', block)
        self.assertIn("16f, true, ink", block)
        self.assertIn("Color.rgb(234, 249, 241)", block)
        self.assertIn("Color.rgb(236, 245, 255)", block)
        self.assertNotIn("👤", block)
        self.assertNotIn("📍", block)

    def test_customer_detail_shows_labeled_contact_and_order_history(self):
        block = SRC.split("private fun renderCustomers(", 1)[1].split("private fun renderDebt(", 1)[0]
        self.assertIn("detailScroll", block)
        self.assertIn("customerInfoRow(detail, R.drawable.ic_satori_phone", block)
        self.assertIn("customerInfoRow(detail, R.drawable.ic_satori_map_pin", block)
        self.assertIn('"LỊCH SỬ HÓA ĐƠN"', block)
        self.assertIn("invoice.customerHasPaid", block)
        self.assertIn("group.forEach", block)

    def test_invoice_uses_same_labeled_customer_details(self):
        block = SRC.split("private fun openInvoice(", 1)[1]
        self.assertIn("customerInfoRow(content, R.drawable.ic_satori_phone", block)
        self.assertIn("customerInfoRow(content, R.drawable.ic_satori_map_pin", block)
        self.assertIn('"THÔNG TIN KHÁCH HÀNG"', block)
        self.assertIn("R.drawable.ic_satori_users", block)

    def test_vector_assets_exist_without_emoji_font_dependency(self):
        for name in ("ic_satori_phone.xml", "ic_satori_map_pin.xml", "ic_satori_users.xml"):
            data = (ICONS / name).read_text(encoding="utf-8")
            self.assertIn("<vector", data)
            self.assertIn("android:pathData", data)


if __name__ == "__main__":
    unittest.main()
