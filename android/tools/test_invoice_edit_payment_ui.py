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
        self.assertIn('requestInvoiceEdit(invoice)', detail)
        helper = UI.split("private fun requestInvoiceEdit(", 1)[1].split("private fun confirmSoftDelete(", 1)[0]
        self.assertIn('if (!canAction("orders.update"))', helper)
        self.assertIn('showConnectionSettings()', helper)
        self.assertIn('launchEditor(editing = invoice)', helper)

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
