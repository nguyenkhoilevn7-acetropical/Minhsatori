#!/usr/bin/env python3
"""Regression: Accounting Pro demos are removed; essential Android accounting remains."""
from pathlib import Path
import unittest

ANDROID = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ANDROID / "app/src/main/java/vn/minhsatori/app"
TEST_ROOT = ANDROID / "app/src/test/java/vn/minhsatori/app"
UI = (SOURCE_ROOT / "NativeMainActivity.kt").read_text(encoding="utf-8")


class AccountingProRemovalTest(unittest.TestCase):
    def test_all_five_demo_modules_and_their_tests_are_gone(self):
        retired = (
            "PaymentAllocation", "Alerts", "ProfitAudit", "BankTriage",
            "DocumentAudit"
        )
        for name in retired:
            with self.subTest(module=name):
                self.assertFalse((SOURCE_ROOT / ("AccountingPro" + name + ".kt")).exists())
                self.assertFalse((TEST_ROOT / ("AccountingPro" + name + "Test.kt")).exists())
        self.assertFalse((ANDROID / "app/src/androidTest/java/vn/minhsatori/app/"
                          "AccountingProScreensInstrumentedTest.kt").exists())

    def test_pro_menu_and_demo_screens_are_not_reachable(self):
        for removed in (
            "KẾ TOÁN PRO", "showAccountingProPreview(",
            "showAccountingProDocuments(", "showAccountingProBankDemo(",
            "showAccountingProProfitAudit(", "showAccountingProReviewAlerts(",
            "showAccountingProAllocationDemo(", "showAccountingProInvoiceList(",
            "ACCOUNTING_PRO_HERMETIC_TEST", "DEMO-LEDGER-A", "DEMO-TX-1"
        ):
            with self.subTest(removed=removed):
                self.assertNotIn(removed, UI)

    def test_original_business_flows_and_owner_safety_are_preserved(self):
        for essential in (
            "private fun renderDebt(", "private fun renderInvoices(",
            "private fun renderOverview(", "private fun renderNewOrderInfo(",
            "private fun launchEditor(", "private fun requestInvoiceEdit(",
            "private fun showLedger(", "private fun openInvoice(",
            "private fun confirmInvoicePayment(",
            "private fun renderV2OwnerBackend(",
            "AiCustomerPortalActivity::class.java",
            "payments.markCustomerPaid", "payments.markCustomerUnpaid",
            "payments.markSatoriPaid", "payments.markSatoriUnpaid",
            "AccountingProReadOnly.invoiceRows(data.invoices)",
            "latest.canEditOrDelete", "canAction(\"orders.update\")",
            "syncPreferredSource()", "InvoiceBadgeState",
        ):
            with self.subTest(essential=essential):
                self.assertIn(essential, UI)

    def test_45_percent_core_profit_and_debt_filters_still_work_as_ui(self):
        for essential in (
            "AccountingProMargin45.calculate(data.invoices)",
            "AccountingProDebtProfitPolicy.report(",
            "private fun showMarginPeriod(",
            "private fun showDebtProfitFilter(",
            "showProfitInsideInvoiceCard(parent, marginByInvoice[invoice])",
            'totalCard("Tổng lợi nhuận"',
            "TỔNG LÃI GỘP ƯỚC TÍNH",
            "☷ Lọc danh sách hóa đơn",
        ):
            with self.subTest(essential=essential):
                self.assertIn(essential, UI)
        model = (SOURCE_ROOT / "AccountingProMargin45.kt").read_text(encoding="utf-8")
        self.assertIn("SUPPLIER_DISCOUNT_PERCENT = 45", model)
        for forbidden in ("orders.create", "payments.mark", "sendEmail("):
            self.assertNotIn(forbidden, model)


if __name__ == "__main__":
    unittest.main()
