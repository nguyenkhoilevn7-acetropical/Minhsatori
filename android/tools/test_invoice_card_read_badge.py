"""New invoice alerts are acknowledged per card, not on tab entry or bulk-read."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIVE = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")


class InvoiceCardReadBadgeContract(unittest.TestCase):
    def test_detail_dismiss_acknowledges_only_displayed_invoice(self):
        detail = NATIVE.split("private fun openInvoice(invoice: SatoriInvoice)", 1)[1]
        detail = detail.split("private fun configureMobileApi()", 1)[0]
        assert "dialog.setOnDismissListener" in detail
        on_close = detail.split("dialog.setOnDismissListener", 1)[1].split("dialog.setOnShowListener", 1)[0]
        self.assertIn("invoice.number.toLongOrNull()", on_close)
        self.assertIn("number in currentInvoiceBadge().unread", on_close)
        self.assertIn("acknowledgeInvoiceBadge(number)", on_close)
        self.assertIn("render()", on_close)
        self.assertNotIn("acknowledgeAll", on_close)

    def test_home_and_bottom_badges_share_same_unread_state(self):
        self.assertIn('if (index == 0 && currentInvoiceBadge().count > 0)', NATIVE)
        self.assertIn('if (index == 1 && currentInvoiceBadge().count > 0)', NATIVE)
        self.assertIn('it in currentInvoiceBadge().unread', NATIVE)


if __name__ == "__main__":
    unittest.main()
