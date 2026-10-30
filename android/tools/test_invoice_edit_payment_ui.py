"""Synthetic/source regressions for owner-only edit and payment affordances.

These tests do not call real API or verify Android UI visually.
"""
from pathlib import Path
import unittest

BASE = Path(__file__).resolve().parents[1]
ROOT = BASE.parent
UI = (BASE / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
EDITOR = (BASE / "app/src/main/java/vn/minhsatori/app/NativeOrderEditor.kt").read_text(encoding="utf-8")
MOBILE = (ROOT / "api/AndroidOwnerMobileApi.gs").read_text(encoding="utf-8")
BOT = (ROOT / "api/BotApi.gs").read_text(encoding="utf-8")


class OwnerInvoiceEditPaymentContract(unittest.TestCase):
    def test_edit_button_is_visible_on_eligible_invoice_before_api_authorization(self):
        detail = UI.split("private fun openInvoice(", 1)[1].split("private fun configureMobileApi(", 1)[0]
        self.assertIn('if (invoice.canEditOrDelete)', detail)
        self.assertIn('button(content, "SỬA HÓA ĐƠN"', detail)
        self.assertIn('if (!canAction("orders.update"))', detail)
        self.assertIn('showConnectionSettings()', detail)
        self.assertIn('launchEditor(editing = invoice)', detail)

    def test_card_edit_opens_real_editor_only_after_server_authorization(self):
        card = UI.split("private fun invoiceQuickCard(", 1)[1].split(
            "private fun confirmSoftDelete(", 1)[0]
        self.assertIn('compactAction("Sửa", cyan)', card)
        self.assertIn("requestInvoiceEdit(invoice)", card)
        self.assertIn("openInvoice(invoice)", card)
        guard = UI.split("private fun requestInvoiceEdit(", 1)[1].split(
            "private fun invoiceQuickCard(", 1)[0]
        self.assertIn("singleOrNull", guard)
        self.assertIn("identityReliable", guard)
        self.assertIn("latest.canEditOrDelete", guard)
        self.assertIn('canAction("orders.update")', guard)
        self.assertIn("showConnectionSettings()", guard)
        self.assertIn("launchEditor(editing = latest)", guard)
        self.assertNotIn("executeWrite(", guard)

    def test_unpaid_status_uses_debt_amber_and_profit_is_top_right_badge(self):
        card = UI.split("private fun invoiceQuickCard(", 1)[1].split(
            "private fun confirmSoftDelete(", 1)[0]
        self.assertIn('invoice.status.contains("chưa thanh toán", ignoreCase = true)', card)
        self.assertIn('Color.rgb(181, 95, 6)', card)
        self.assertIn('Color.rgb(16, 122, 78)', card)
        self.assertIn('label(statusLine, invoice.displayDate', card)
        self.assertIn('label(statusLine, invoice.status, 11f, true, statusColor)', card)
        badge = UI.split("private fun showProfitInsideInvoiceCard(", 1)[1].split(
            "private fun requestInvoiceEdit(", 1)[0]
        self.assertIn("header.removeView(amount)", badge)
        self.assertIn("header.addView(right", badge)
        self.assertIn('text = "Lợi nhuận  " +', badge)
        self.assertIn('contentDescription = "Lợi nhuận: "', badge)
        self.assertIn('Color.rgb(255, 243, 241)', badge)
        self.assertIn("showProfitInsideInvoiceCard(list, marginByInvoice[inv])", UI)
        self.assertIn("showProfitInsideInvoiceCard(parent, marginByInvoice[invoice])", UI)

    def test_edit_confirmation_preserves_original_invoice_and_checks_catalogue(self):
        self.assertIn("Tổng bill trước sửa:", EDITOR)
        self.assertIn("Tổng bill sau sửa:", EDITOR)
        self.assertIn("require(listed>=price", EDITOR)
        self.assertIn("if (editing == null) page.addView(newBranch)", EDITOR)
        self.assertIn('payload.put("id",editing.id)', EDITOR)
        self.assertIn('expectedRevision",state.revision', EDITOR)

    def test_independent_payment_actions_visible_but_never_bypass_permission(self):
        detail = UI.split("private fun openInvoice(", 1)[1].split("private fun configureMobileApi(", 1)[0]
        for action in ("payments.markCustomerPaid", "payments.markCustomerUnpaid",
                       "payments.markSatoriPaid", "payments.markSatoriUnpaid"):
            self.assertIn(action, detail)
            self.assertIn(action, MOBILE)
        self.assertIn('if (!canAction(action))', detail)
        self.assertIn("confirmInvoicePayment(invoice, action)", detail)
        self.assertIn('label(content, "CẬP NHẬT THANH TOÁN"', detail)
        self.assertIn('invoice.customerHasPaid', detail)
        self.assertIn('invoice.satoriHasPaid', detail)

    def test_owner_mobile_actions_require_server_authentication(self):
        self.assertIn("'orders.create','orders.update'", MOBILE)
        self.assertIn("var actor=verify(req.accessToken)", MOBILE)
        self.assertIn("productionLedgerProof(readState_())", MOBILE)
        self.assertIn("ownerMobileWrite(action,req.payload,req.nonce)", MOBILE)
        self.assertIn("'orders.update'?updateUnpaidOrder", BOT)
        self.assertNotIn("'orders.update':'orders:write'", BOT)

    def test_editor_keeps_identity_and_revision_and_preview(self):
        self.assertIn('if(editing==null)"LÊN ĐƠN MỚI" else "SỬA HÓA ĐƠN #"', EDITOR)
        self.assertIn('payload.put("id",editing.id)', EDITOR)
        self.assertIn('.put("expectedTotal",editing.total).put("confirmed",true)', EDITOR)
        self.assertIn('if(editing==null)"orders.create" else "orders.update"', EDITOR)
        self.assertIn('SatoriOrderValidation.sum(goods,shipping,vat)', EDITOR)
        self.assertIn("requestId=UUID.randomUUID()", EDITOR)


if __name__ == "__main__":
    unittest.main()
