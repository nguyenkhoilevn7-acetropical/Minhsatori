"""Verify actual approved layout composition, not just palette/tint."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
ACTIVITY=(ROOT/"app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")


class ApprovedLayoutV047(unittest.TestCase):
    def test_home_is_real_hero_and_three_distinct_kpi_cards(self):
        for x in ('fun renderUi25dHome(', '"Chào quản trị viên 👋"',
                  '"Tổng quan kinh doanh"', '"Tổng tiền bán"', '"Công nợ phải thu"',
                  '"Lợi nhuận"', '"Chưa có số liệu"', 'renderUi25dHome(content, data)'):
            self.assertIn(x,ACTIVITY)
        self.assertNotIn("Match MoneyMind's compact teal dashboard",ACTIVITY)

    def test_each_native_tab_has_consistent_screen_header(self):
        self.assertIn("renderUi25dSectionIntro(content, pages[activeTab])",ACTIVITY)
        for name in ["Hóa đơn","Khách hàng","Công nợ","Lên đơn","Cá nhân"]:
            self.assertIn('"'+name+'"',ACTIVITY)

    def test_protected_orders_and_payments_handlers_remain(self):
        for x in ("fun invoiceQuickCard(", "fun confirmInvoicePayment(",
                  "fun confirmSoftDelete(", "fun launchEditor(", "fun executeWrite(",
                  "openPendingNotificationInvoiceIfReady()"):
            self.assertIn(x,ACTIVITY)

    def test_no_fabricated_financial_data(self):
        self.assertIn('if (sales == null) "—"',ACTIVITY)
        self.assertIn('if (data == null) "—"',ACTIVITY)
        self.assertIn('it.isExcluded',ACTIVITY)
        self.assertIn('SatoriData.money(data.outstandingAmount)',ACTIVITY)


if __name__=="__main__":
    unittest.main()
