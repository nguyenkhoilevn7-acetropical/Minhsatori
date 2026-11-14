"""Regression contract: dashboard numbers fit a narrow Android/Fold card.

This test protects the key difference between maxLines=1 (auto-size can measure
available width) and setSingleLine(true) (which enables horizontal scrolling and
may cause the full VND amount to be clipped).
"""
from pathlib import Path
import re
import unittest

SOURCE = (
    Path(__file__).resolve().parents[1]
    / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt"
).read_text(encoding="utf-8")


class MoneyCardAutoFitContract(unittest.TestCase):
    def test_card_number_has_bounded_width_and_minimum_font_size(self):
        match = re.search(
            r"private fun fitCardNumber\(view: TextView,.*?\n    }",
            SOURCE,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(match, "Expected shared number auto-fit helper")
        helper = match.group(0)
        self.assertIn("LinearLayout.LayoutParams.MATCH_PARENT", helper)
        self.assertIn("LinearLayout.LayoutParams.WRAP_CONTENT", helper)
        self.assertIn("view.maxLines = 1", helper)
        self.assertIn("view.setHorizontallyScrolling(false)", helper)
        self.assertIn("view.ellipsize = null", helper)
        self.assertIn("view.setAutoSizeTextTypeUniformWithConfiguration(", helper)
        self.assertIn("maxSp: Int = 21, minSp: Int = 9", helper)

    def test_sales_summary_and_count_always_use_adaptive_text(self):
        self.assertIn("fitCardNumber(salesAmount)", SOURCE)
        self.assertIn("fitCardNumber(invoiceCount)", SOURCE)
        self.assertNotIn("salesAmount.setSingleLine(true)", SOURCE)
        self.assertIn("SatoriData.money(salesTotal)", SOURCE)
        self.assertIn("invoiceMoneyRed, 5", SOURCE)

    def test_other_dashboard_financial_cards_use_same_policy(self):
        self.assertIn("fitCardNumber(number, maxSp = 19)", SOURCE)
        self.assertIn("fitCardNumber(label(box, value, 18f, true, accent, 7)", SOURCE)
        self.assertIn('kpi("Công nợ phải thu",', SOURCE)
        self.assertIn('kpi("Lợi nhuận",', SOURCE)

    def test_autofit_never_modifies_money_or_order_data(self):
        helper = SOURCE.split("private fun fitCardNumber(", 1)[1].split(
            "\n    private fun panelBackground(", 1
        )[0]
        self.assertNotIn("SatoriData.money(", helper)
        self.assertNotIn("orders.update", helper)
        self.assertNotIn("edit(", helper)
        self.assertNotIn("snapshot", helper)


if __name__ == "__main__":
    unittest.main()
