"""Read-only Android invoice detail layout contract; no production invoice reads."""
from pathlib import Path
from xml.etree import ElementTree
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text()
DETAIL = SRC.split("private fun openInvoice(", 1)[1].split("private fun configureMobileApi(", 1)[0]
POLICY = (ROOT / "app/src/main/java/vn/minhsatori/app/InvoiceProductPresentation.kt").read_text()


class ProductInvoicePresentationContract(unittest.TestCase):
    def test_product_icons_are_individual_real_vector_assets(self):
        self.assertIn("InvoiceProductPresentation.icon(line.description, line.code)", DETAIL)
        for key in ("water", "guava", "soursop", "fruit", "drink", "package"):
            self.assertIn(f"R.drawable.ic_product_{key}", DETAIL)
            vector = ROOT / "app/src/main/res/drawable" / f"ic_product_{key}.xml"
            data = vector.read_text(encoding="utf-8")
            ElementTree.fromstring(data)
            self.assertIn("<vector", data)
            self.assertIn("android:pathData=", data)
        self.assertIn('contentDescription = "Biểu tượng " + line.description', DETAIL)

    def test_subtotal_inside_same_card_before_delivery_fee_and_vat(self):
        product = DETAIL.split('val productCard = invoiceSection(productBlock,', 1)[1]
        product = product.split('val validInvoiceNumber = invoice.number', 1)[0]
        self.assertIn('productCard.addView(discountLine)', product)
        order = ('invoicePriceRow(productCard, "Thành tiền", storedLineSubtotal)',
                 'productCard.addView(discountLine)',
                 'invoicePriceRow(productCard, "Phí giao", invoice.shipping)',
                 'invoicePriceRow(productCard, "Thuế VAT", invoice.vat)',
                 'productCard.addView(productTotal')
        assert all(x in product for x in order)
        self.assertEqual([product.index(x) for x in order],
                         sorted(product.index(x) for x in order))
        self.assertNotIn('label(textGroup, "Thành tiền:', product)

    def test_percent_is_read_only_and_handles_unavailable_or_mixed(self):
        self.assertIn('line.discountPercent', POLICY)
        self.assertIn('line.listPrice', POLICY)
        self.assertIn('line.unitPrice', POLICY)
        self.assertIn('"Chưa có dữ liệu"', POLICY)
        self.assertIn('"Theo từng sản phẩm"', POLICY)
        self.assertIn('InvoiceProductPresentation.invoiceDiscountLabel(invoice.lines)', DETAIL)
        self.assertIn('SatoriData.money(invoice.displayPayable)', DETAIL)
        self.assertIn('NativeInvoicePdf.preview(this, invoice)', DETAIL)
        self.assertIn('confirmInvoicePayment(invoice, action)', DETAIL)


if __name__ == "__main__":
    unittest.main()
