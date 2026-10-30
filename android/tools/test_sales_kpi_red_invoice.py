"""Regression: total sold and red invoice figures are always visible to owner."""
from pathlib import Path
import re
import unittest
import struct

ROOT = Path(__file__).resolve().parents[1]
SRC = (ROOT/"app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
MODEL = (ROOT/"app/src/main/java/vn/minhsatori/app/SatoriModels.kt").read_text(encoding="utf-8")
GRADLE = (ROOT/"app/build.gradle.kts").read_text(encoding="utf-8")

class SalesKpiAndRedAmounts(unittest.TestCase):
    def test_home_has_total_sales_before_debt_with_true_ledger_totals(self):
        home = SRC.split('if (activeTab == 0) {\n            val hero',1)[1].split('content.addView(hero',1)[0]
        self.assertIn('label(salesCard, "Tổng tiền bán"',home)
        self.assertIn('data?.invoices?.filterNot { it.isExcluded }',home)
        self.assertIn('?.sumOf { it.total }',home)
        self.assertIn('data?.invoices?.count { !it.isExcluded }',home)
        self.assertIn('label(moneyCard, "Tổng công nợ cần thu"',home)
        self.assertLess(home.index('summaryCards.addView(salesCard'),home.index('summaryCards.addView(moneyCard'))
        self.assertIn('resources.configuration.screenWidthDp >= 460',home)
        self.assertIn('setOnClickListener { activeTab = 1; render() }',home)

    def test_total_sales_are_not_counted_twice_and_offline_is_honest(self):
        self.assertIn('isTest || isInternalCollaboratorBill',MODEL)
        self.assertIn('status.equals("Không Tính", ignoreCase = true)',MODEL)
        self.assertIn('status.equals("Đã hủy", ignoreCase = true)',MODEL)
        self.assertIn('if (salesAmount == null) "—"',SRC)
        self.assertIn('val salesTotal = data.invoices.filterNot { it.isExcluded }.sumOf { it.total }',SRC)
        self.assertIn('label(salesSummary, SatoriData.money(salesTotal)',SRC)

    def test_invoices_red_even_after_search_filter_rebuild(self):
        self.assertIn('private val invoiceMoneyRed = Color.rgb(220, 38, 38)',SRC)
        self.assertIn('if (moneyAmountPattern.matches(current.toString().trim()))',SRC)
        self.assertIn('view.setTextColor(invoiceMoneyRed)',SRC)
        self.assertIn('highlightMoneyInView(list)',SRC)
        self.assertIn('text = highlightMoney(content)',SRC)
        self.assertIn('android.text.style.ForegroundColorSpan(invoiceMoneyRed)',SRC)
        self.assertIn('label(salesSummary, SatoriData.money(salesTotal)',SRC)
        self.assertIn('if (activeTab == 0 || activeTab == 1 || activeTab == 3)',SRC)

    def test_upgrades_existing_app_without_modifying_payment_or_pdf_routes(self):
        self.assertIn('applicationId = "vn.minhsatori.app"',GRADLE)
        self.assertIn('versionCode = 43',GRADLE)
        self.assertIn('versionName = "0.4.26"',GRADLE)
        for method in ['confirmInvoicePayment','confirmSoftDelete','executeWrite',
                       'launchEditor','recoverDriveAccessUsingOwnerApi',
                       'openInvoice','invoiceQuickCard']:
            self.assertIn('private fun '+method+'(',SRC)
        self.assertIn('NativeInvoicePdf.share(this, invoice)',SRC)
        self.assertIn('NativeInvoicePdf.preview(this, invoice)',SRC)

if __name__ == '__main__': unittest.main()
