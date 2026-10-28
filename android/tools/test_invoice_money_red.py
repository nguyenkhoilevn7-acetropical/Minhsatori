"""Money amount color contract: only VND figures red, invoice/debt paths intact."""
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SRC=(ROOT/"app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
MONEY=re.compile(r"(?<![\w])[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:đ|₫)(?!\w)",re.I)

class InvoiceMoneyColorContract(unittest.TestCase):
    def test_currency_regex_highlights_amount_not_invoice_ids_or_dates(self):
        examples={
            "Hóa đơn #5953 · 27/10/2026 · 423.360 đ":["423.360 đ"],
            "Đã thu: 10.000 đ • Cần thu: 2.098.072 đ":["10.000 đ","2.098.072 đ"],
            "Đơn giá 650.000₫, VAT 0 đ":["650.000₫","0 đ"],
            "Hóa đơn #5952, SĐT 0983000970; 27/10/2026":[],
        }
        for text,expected in examples.items():
            with self.subTest(text=text):
                self.assertEqual([x.group() for x in MONEY.finditer(text)],expected)

    def test_all_native_currency_labels_use_red_spans(self):
        self.assertIn("private val invoiceMoneyRed = Color.rgb(220, 38, 38)",SRC)
        self.assertIn("text = highlightMoney(content)",SRC)
        self.assertIn("android.text.style.ForegroundColorSpan(invoiceMoneyRed)",SRC)
        self.assertIn("android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE",SRC)
        self.assertIn("if (activeTab == 0 || activeTab == 1 || activeTab == 3)",SRC)
        self.assertIn("highlightMoneyInView(content)",SRC)
        self.assertIn("is EditText -> Unit",SRC)
        self.assertIn("for (index in 0 until view.childCount) highlightMoneyInView(view.getChildAt(index))",SRC)
        self.assertIn("moneyAmountPattern.findAll(content)",SRC)

    def test_payment_status_and_accounting_methods_remain_unmodified(self):
        for fn in ("private fun confirmInvoicePayment(", "private fun executeWrite(",
                   "private fun openInvoice(", "private fun invoiceQuickCard("):
            self.assertIn(fn,SRC)
        self.assertIn("invoice.customerHasPaid",SRC)
        self.assertIn("invoice.satoriHasPaid",SRC)

if __name__ == "__main__":
    unittest.main()
