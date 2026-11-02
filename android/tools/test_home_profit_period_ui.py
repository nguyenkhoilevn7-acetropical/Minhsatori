"""Read-only home profit filter and CTV source-integrity UI contracts."""
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/"app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
HOME=SOURCE.split("private fun renderMoneyMindRecent(",1)[1].split("private fun renderUi25dSectionIntro(",1)[0] if False else SOURCE.split("private fun selectHomeProfitPeriod(",1)[0]
SELECT=SOURCE.split("private fun selectHomeProfitPeriod(",1)[1].split("private fun renderUi25dSectionIntro(",1)[0]
SOURCE_POLICY=(ROOT/"app/src/main/java/vn/minhsatori/app/CtvProfitSourcePolicy.kt").read_text(encoding="utf-8")
MARGIN=(ROOT/"app/src/main/java/vn/minhsatori/app/AccountingProMargin45.kt").read_text(encoding="utf-8")

class HomeProfitPeriodUiTest(unittest.TestCase):
 def test_inline_time_filters_and_local_date_dialog(self):
  self.assertIn('listOf("Tất cả", "Ngày", "Tháng", "Năm")',HOME)
  self.assertIn('selectHomeProfitPeriod(index, data)',HOME)
  self.assertIn('homeProfitPeriod = AccountingProMargin45Period.day(day)',SELECT)
  self.assertIn('AccountingProMargin45Period.month(year, monthZeroBased + 1)',SELECT)
  self.assertIn('AccountingProMargin45Period.year(years[idx])',SELECT)
  self.assertIn('java.time.ZoneId.of("Asia/Ho_Chi_Minh")',SELECT)
 def test_no_guessing_gross_as_net(self):
  self.assertIn('CtvProfitSourcePolicy::profitRows',HOME)
  self.assertIn('AccountingProMargin45.summarize(it, homeProfitPeriod)',HOME)
  self.assertIn('verifiedRegistry && profitSummary != null',HOME)
  self.assertIn('profitSummary.missingInvoiceCount == 0',HOME)
  self.assertIn('profitSummary.excludedInvalidDates == 0',HOME)
  self.assertIn('Thiếu hồ sơ CTV từ nguồn đồng bộ',HOME)
  self.assertIn('showConnectionSettings()',HOME)
  self.assertIn('estimatedOwnerMarginVnd = null',SOURCE_POLICY)
  self.assertIn('invoice.shipping',MARGIN)
  self.assertIn('invoice.vat',MARGIN)
 def test_drilldown_inherits_home_scope_and_cannot_show_partial_as_total(self):
  self.assertIn('periodChoice.setSelection(homeProfitChoice.coerceIn(0, 3))',SOURCE)
  self.assertIn('val homeDate=homeProfitPeriod.from ?: today',SOURCE)
  self.assertIn('summary.missingInvoiceCount == 0',SOURCE)
  self.assertIn('complete && summary.excludedInvalidDates == 0',SOURCE)
  self.assertIn('homeProfitPeriod.title',HOME)
  self.assertNotIn('confirmedProfit ?: "Chờ đồng bộ"',HOME)

if __name__=="__main__":
 unittest.main()
