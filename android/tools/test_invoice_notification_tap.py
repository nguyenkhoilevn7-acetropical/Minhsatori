"""Regression contracts for Android notification tap -> native invoice details."""
import unittest
from pathlib import Path

NATIVE = (Path(__file__).resolve().parents[1] /
    "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
MANIFEST = (Path(__file__).resolve().parents[1] /
    "app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")


class InvoiceNotificationTapTest(unittest.TestCase):
    def test_notification_has_real_immutable_activity_pending_intent(self):
        section = NATIVE.split("private fun notifyVerifiedNewInvoices(", 1)[1].split(
            "private fun hasServerAction(", 1)[0]
        self.assertIn("PendingIntent.getActivity(this, newOrderNotificationId", section)
        self.assertIn("PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE", section)
        self.assertIn("setContentIntent(openInvoiceIntent)", section)
        self.assertIn("Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP", section)
        self.assertIn("setAutoCancel(true)", section)
        self.assertIn("update.fresh.maxOrNull()", section)

    def test_cold_and_warm_app_routes_are_handled(self):
        self.assertIn("queueInvoiceFromNotification(intent)", NATIVE)
        self.assertIn("override fun onNewIntent(intent: Intent)", NATIVE)
        self.assertIn("setIntent(intent)", NATIVE)
        self.assertIn("openPendingNotificationInvoiceIfReady()", NATIVE)
        self.assertIn("val candidates = snapshot?.invoices?.filter { it.number.toLongOrNull() == no }", NATIVE)
        self.assertIn("if (candidates.size > 1)", NATIVE)
        self.assertIn("pendingNotificationInvoiceNo = null", NATIVE)
        self.assertIn("val invoice = candidates.singleOrNull() ?: return", NATIVE)
        self.assertNotIn("snapshot?.invoices?.firstOrNull { it.number.toLongOrNull() == no }", NATIVE)
        self.assertIn("latest.invoices.singleOrNull {", NATIVE)
        self.assertNotIn("latest.invoices.firstOrNull {", NATIVE)
        self.assertIn("openInvoice(invoice)", NATIVE)
        self.assertIn("android:name=\".NativeMainActivity\"", MANIFEST)

    def test_deep_link_contains_only_invoice_number_and_never_bypasses_sync(self):
        section = NATIVE.split("val destination = Intent(this, NativeMainActivity::class.java)", 1)[1].split("@Suppress(\"DEPRECATION\")", 1)[0]
        self.assertIn(".putExtra(newInvoiceTapExtra, newestNo)", section)
        self.assertNotIn("customer", section)
        self.assertNotIn("token", section)
        self.assertNotIn("amount", section)
        handler = NATIVE.split("private fun openPendingNotificationInvoiceIfReady()", 1)[1].split("private fun badgePill(",1)[0]
        self.assertIn("val candidates = snapshot?.invoices?.filter { it.number.toLongOrNull() == no }", handler)
        self.assertIn("val invoice = candidates.singleOrNull() ?: return", handler)
        self.assertIn("pendingNotificationInvoiceNo = null", handler)

    def test_reading_one_invoice_clears_matching_notification_only_when_no_unread(self):
        badge = NATIVE.split("private fun acknowledgeInvoiceBadge(number: Long)",1)[1].split("private fun badgePill(",1)[0]
        self.assertIn("InvoiceBadgePolicy.acknowledgeOne", badge)
        self.assertIn("if (next.count == 0)", badge)
        self.assertIn(".cancel(newOrderNotificationId)", badge)


if __name__ == "__main__":
    unittest.main()
