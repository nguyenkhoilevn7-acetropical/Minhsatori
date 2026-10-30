#!/usr/bin/env python3
"""Accounting Pro Android-only isolation gate (read-only; no production writes)."""
from pathlib import Path
import unittest

ANDROID = Path(__file__).resolve().parents[1]
KOTLIN = ANDROID / "app/src/main/java/vn/minhsatori/app"


class AccountingProIsolationTest(unittest.TestCase):
    def test_new_accounting_models_cannot_call_payment_or_order_writers(self):
        for filename in ["AccountingProReadOnly.kt", "AccountingProPaymentAllocation.kt"]:
            source = (KOTLIN / filename).read_text(encoding="utf-8")
            for forbidden in (
                "HttpURLConnection", "Retrofit", "OkHttp", "FileOutputStream",
                "SharedPreferences", "orders.create", "orders.update",
                "payments.markCustomerPaid", "payments.markCustomerUnpaid",
                "payments.markSatoriPaid", "payments.markSatoriUnpaid",
                "api/v2/confirm", "fetch(", "URL("
            ):
                with self.subTest(file=filename, forbidden=forbidden):
                    self.assertNotIn(forbidden, source)

    def test_old_native_order_payment_gemini_and_invoice_entrypoints_remain(self):
        source = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        for required in (
            "private fun renderDebt(",
            "private fun renderNewOrderInfo(",
            "private fun openInvoice(",
            "private fun showLedger(",
            "private fun renderV2OwnerBackend(",
            "private fun launchEditor(",
            "payments.markCustomerPaid",
            "payments.markCustomerUnpaid",
            "payments.markSatoriPaid",
            "payments.markSatoriUnpaid",
            "AiCustomerPortalActivity::class.java",
            "InvoiceBadgeState",
        ):
            with self.subTest(required=required):
                self.assertIn(required, source)

    def test_new_ui_is_opt_in_and_uses_existing_snapshot_only(self):
        source = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        self.assertIn("private fun showAccountingProPreview(data: SatoriSnapshot)", source)
        self.assertIn("private fun showAccountingProInvoiceList(data: SatoriSnapshot)", source)
        self.assertIn("AccountingProReadOnly.summarize(data.invoices)", source)
        self.assertIn("AccountingProReadOnly.invoiceRows(data.invoices)", source)
        self.assertIn("CHỈ XEM", source)
        self.assertIn("KHÔNG phải số dư sau trả từng phần", source)


if __name__ == "__main__":
    unittest.main()
