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

    def test_owner_profit45_uses_historical_list_cost_and_has_all_period_filters(self):
        source = (KOTLIN / "AccountingProMargin45.kt").read_text(encoding="utf-8")
        self.assertIn("SUPPLIER_DISCOUNT_PERCENT = 45", source)
        self.assertIn("invoice.lines", source)
        self.assertIn("discounted(pair.second,SUPPLIER_DISCOUNT_PERCENT)", source)
        self.assertIn("AccountingProReadOnly.invoiceRows(invoices)", source)
        self.assertIn("estimatedOwnerMarginVnd", source)
        self.assertIn("fun day(", source)
        self.assertIn("fun month(", source)
        self.assertIn("fun year(", source)
        self.assertIn("fun custom(", source)
        for forbidden in ("HttpURLConnection", "OkHttp", "Retrofit",
                          "orders.create", "payments.mark", "writeInvoice(",
                          "sendEmail(", "SharedPreferences", "FileOutputStream"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
        ui = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        self.assertIn("TỔNG LÃI GỘP ƯỚC TÍNH", ui)
        self.assertIn("private fun showAccountingProMarginPeriod(data: SatoriSnapshot)", ui)
        self.assertIn('text = "Lợi nhuận  " +', ui)
        self.assertIn("showProfitInsideInvoiceCard(list, marginByInvoice[inv])", ui)
        self.assertIn("showProfitInsideInvoiceCard(parent, marginByInvoice[invoice])", ui)
        self.assertIn('totalCard("Tổng lợi nhuận"', ui)
        self.assertIn("private fun showDebtProfitFilter()", ui)
        self.assertIn("AccountingProDebtProfitPolicy.report(", ui)
        self.assertNotIn("Lãi gộp ước tính (CK nhập 45%): ", ui)
        # UI is projected from existing historical ledger; do not touch APIs.
        period_model = (KOTLIN / "AccountingProDebtProfitPolicy.kt").read_text(
            encoding="utf-8")
        self.assertIn("period.includes(invoice)", period_model)
        self.assertIn("invoice.isOutstanding", period_model)
        self.assertIn("AccountingProMargin45.summarize(margins, period)", period_model)
        for forbidden in ("HttpURLConnection", "orders.create", "payments.mark",
                          "writeInvoice(", "sendEmail(", "SharedPreferences"):
            self.assertNotIn(forbidden, period_model)
        self.assertIn("LÃI GỘP ƯỚC TÍNH", ui)

    def test_document_review_is_metadata_only_without_email_or_tax_writers(self):
        model = (KOTLIN / "AccountingProDocumentAudit.kt").read_text(encoding="utf-8")
        self.assertIn("NOT_AVAILABLE_IN_SNAPSHOT", model)
        self.assertIn("verifiedLegalEInvoiceCount: Int? = null", model)
        for forbidden in ("HttpURLConnection", "sendEmail(", "sendVatInvoice(",
                          "publishInvoice(", "orders.create", "payments.mark"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, model)
        ui = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        start = ui.index("    private fun showAccountingProDocuments(data: SatoriSnapshot)")
        end = ui.index("    /**", start + 1)
        screen = ui[start:end]
        self.assertIn("AccountingProDocumentAudit.summary(data.invoices)", screen)
        self.assertIn("Chưa xác minh", screen)
        for forbidden in ("startActivity(", "launchEditor(", "performWrite(",
                          "sendEmail(", "HttpURLConnection", "orders.create",
                          "payments.mark"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, screen)

    def test_bank_demo_is_synthetic_and_has_no_provider_api_or_payment_writes(self):
        model = (KOTLIN / "AccountingProBankTriage.kt").read_text(encoding="utf-8")
        for forbidden in ("HttpURLConnection", "Retrofit", "OkHttp",
                          "payments.markCustomerPaid", "orders.create",
                          "bank.sepay", "apiKey", "sendPayment("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, model)
        source = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        start = source.index("    private fun showAccountingProBankDemo()")
        end = source.index("    /**", start + 1)
        screen = source[start:end]
        self.assertIn("DEMO-TX-1", screen)
        self.assertIn("DEMO-BILL-A", screen)
        self.assertIn("AccountingProBankTriage.preview(", screen)
        for forbidden in ("refreshFromMobileApi(", "launchEditor(",
                          "payments.mark", "startActivity(", "HttpURLConnection",
                          "data.invoices", "snapshot?.invoices", "fetch("):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, screen)

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

    def test_owner_requested_three_overview_cards_are_removed_without_dropping_validation(self):
        source = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
        start = source.index("    private fun showAccountingProPreview(data: SatoriSnapshot)")
        end = source.index("    /**", start + 1)
        overview = source[start:end]
        for removed in (
            'section(panel, "Đã đánh dấu trả Satori:',
            'section(panel, "CẦN ĐỐI CHIẾU ID HÓA ĐƠN"',
            'section(panel, "Ngày hóa đơn cần kiểm tra:'
        ):
            with self.subTest(removed=removed):
                self.assertNotIn(removed, overview)
        # Retain fail-closed invoice-money protection and all destination screens.
        self.assertIn("AccountingProReadOnly.summarize(data.invoices)", overview)
        self.assertIn("if (totals.questionableInvoiceCount == 0)", overview)
        self.assertIn("showAccountingProInvoiceList(data)", overview)
        self.assertIn("showAccountingProReviewAlerts(data)", overview)
        self.assertIn("showAccountingProProfitAudit(data)", overview)
        self.assertIn("showAccountingProBankDemo()", overview)
        self.assertIn("showAccountingProDocuments(data)", overview)
        self.assertIn("showAccountingProAllocationDemo()", overview)
        model = (KOTLIN / "AccountingProReadOnly.kt").read_text(encoding="utf-8")
        self.assertIn("satoriPaidFlagCount", model)
        self.assertIn("questionableInvoiceCount", model)
        self.assertIn("invalidDateCount", model)

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
