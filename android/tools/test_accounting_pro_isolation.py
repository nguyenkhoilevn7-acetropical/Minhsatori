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

    def test_profit_ctv_is_read_only_without_fabricated_profit(self):
        model = (KOTLIN / "AccountingProProfitAudit.kt").read_text(encoding="utf-8")
        self.assertIn("verifiedNetProfitVnd: Long? = null", model)
        self.assertIn("verifiedCommissionLiabilityVnd: Long? = null", model)
        self.assertIn("AccountingProReadOnly.invoiceRows(invoices)", model)
        for forbidden in ("HttpURLConnection", "OkHttp", "Retrofit",
                          "payments.markCustomerPaid", "orders.create",
                          "writeInvoice(", "sendEmail("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, model)
        ui = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        start = ui.index("    private fun showAccountingProProfitAudit(data: SatoriSnapshot)")
        end = ui.index("    /**", start + 1)
        screen = ui[start:end]
        self.assertIn("AccountingProProfitAudit.summary(data.invoices)", screen)
        self.assertIn("Chưa đủ dữ liệu", screen)
        for forbidden in ("performWrite(", "launchEditor(", "HttpURLConnection",
                          "payments.mark", "startActivity(", "createInvoice("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, screen)

    def test_accounting_alerts_have_no_delivery_or_financial_writers(self):
        policy = (KOTLIN / "AccountingProAlerts.kt").read_text(encoding="utf-8")
        for prohibited in ("HttpURLConnection", "sendEmail(", "sendReminder(",
            "postNotification(", "payments.markCustomerPaid", "orders.create",
            "System.currentTimeMillis()", "LocalDate.now()"):
            with self.subTest(prohibited=prohibited):
                self.assertNotIn(prohibited, policy)
        source = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        start = source.index("    private fun showAccountingProReviewAlerts(data: SatoriSnapshot)")
        end = source.index("    /**", start + 1)
        view = source[start:end]
        self.assertIn("AccountingProAlertPolicy.fromSnapshot(data.invoices)", view)
        self.assertIn("Không coi đây là nợ quá hạn", view)
        for prohibited in ("sendPayment(", "sendEmail(", "sendReminder(",
            "startActivity(", "launchEditor(", "Api", "payments.mark", "HttpURLConnection"):
            with self.subTest(prohibited=prohibited):
                self.assertNotIn(prohibited, view)

    def test_payment_demo_uses_only_synthetic_invoices_and_never_calls_writer(self):
        source = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        start = source.index("    private fun showAccountingProAllocationDemo() {")
        end = source.index("    /**", start + 1)
        demo = source[start:end]
        self.assertIn("DEMO-LEDGER-A", demo)
        self.assertIn("DEMO-LEDGER-B", demo)
        self.assertIn("990001L", demo)
        self.assertIn("990002L", demo)
        self.assertIn("AccountingProPaymentAllocation.preview(", demo)
        self.assertIn("KHÔNG GHI SỔ", demo)
        self.assertIn("KHÔNG LƯU", demo)
        self.assertNotIn("data.invoices", demo)
        self.assertNotIn("snapshot?.invoices", demo)
        for forbidden in (
            "performWrite(", "sendPayment(", "executePayment(", "refreshFromMobileApi(",
            "payments.markCustomerPaid", "payments.markSatoriPaid",
            "launchEditor(", "apiEndpoint", "HttpURLConnection", "startActivity("
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, demo)

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
