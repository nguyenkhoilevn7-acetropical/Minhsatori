"""Contracts: a blocked Android notification is not acknowledged as delivered.

These tests intentionally do not claim FCM/instant delivery while the app is closed.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIVE = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
REG = (ROOT / "app/src/main/java/vn/minhsatori/app/V2RegistrationAlerts.kt").read_text(encoding="utf-8")
BADGE = (ROOT / "app/src/main/java/vn/minhsatori/app/InvoiceBadgePolicy.kt").read_text(encoding="utf-8")


class NotificationDeliveryRecoveryTest(unittest.TestCase):
    def test_invoice_alert_persists_only_after_os_accepts_post(self):
        handler = NATIVE.split("private fun notifyVerifiedNewInvoices(", 1)[1].split(
            "private fun hasServerAction(", 1)[0]
        self.assertIn("InvoiceNotificationDeliveryPolicy.pending(update.state.unread, accepted)", handler)
        self.assertIn("if (!notifications.areNotificationsEnabled()) return", handler)
        self.assertIn("NotificationManager.IMPORTANCE_NONE", handler)
        self.assertIn("try {\n            notifications.notify(newOrderNotificationId, notification.build())", handler)
        self.assertLess(handler.index("notifications.notify(newOrderNotificationId, notification.build())"),
                        handler.index('putStringSet("invoice_alert_delivered_v1"'))
        self.assertNotIn("if (update.fresh.isEmpty()) return", handler)
        self.assertIn("fun pending(unread: Set<Long>, accepted: Set<Long>)", BADGE)

    def test_invoice_pending_is_retried_when_app_resumes(self):
        on_resume = NATIVE.split("override fun onResume()", 1)[1].split(
            "override fun onPause()", 1)[0]
        self.assertIn("snapshot?.let { notifyVerifiedNewInvoices(it, it) }", on_resume)

    def test_registration_new_hashes_are_acknowledged_only_after_post(self):
        process = REG.split("@Synchronized fun process(", 1)[1].split(
            "private fun notify(", 1)[0]
        self.assertIn("val posted=fresh.isNotEmpty()&&notify(", process)
        self.assertIn("!initialized || posted -> feed.items.map{it.first}", process)
        self.assertIn("else -> feed.items.map{it.first}.filter{it in previous}", process)
        self.assertLess(process.index("val posted="), process.index('putStringSet("seen_hashes"'))

    def test_registration_os_rejection_does_not_mark_seen(self):
        notifier = REG.split("private fun notify(", 1)[1].split(
            "class V2RegistrationAlertJob", 1)[0]
        self.assertIn("mgr.areNotificationsEnabled()", notifier)
        self.assertIn("NotificationManager.IMPORTANCE_NONE", notifier)
        self.assertIn("return try{mgr.notify(JOB,notification);true}", notifier)
        self.assertIn("POST_NOTIFICATIONS", notifier)

    def test_background_limit_is_explicit_not_fake_push(self):
        self.assertIn("setPeriodic(15*60*1000L)", REG)
        self.assertIn("True instant background push would require FCM", REG)
        self.assertIn("if (!foreground) return", NATIVE)


if __name__ == "__main__":
    unittest.main()
