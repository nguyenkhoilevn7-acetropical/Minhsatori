"""Source contracts for the owner FCM push path (no device, no network)."""
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app/src/main/java/vn/minhsatori/app"
PUSH = (APP / "SatoriFirebasePush.kt").read_text()
MAIN = (APP / "NativeMainActivity.kt").read_text()
MANIFEST = (ROOT / "app/src/main/AndroidManifest.xml").read_text()
RELEASE_WF = (ROOT.parent / ".github/workflows/android-release-apk.yml").read_text()
REQUEST = json.loads((ROOT / "release-request.json").read_text())


class OwnerPushE2EContract(unittest.TestCase):
    def test_token_rotation_reregisters_through_network_job(self):
        on_new = PUSH.split("override fun onNewToken", 1)[1]
        self.assertIn("SatoriPush.onTokenRefreshed(applicationContext)", on_new)
        self.assertIn("SatoriPushRegistrationJob::class.java", PUSH)
        self.assertIn("JobInfo.NETWORK_TYPE_ANY", PUSH)
        self.assertIn('android:name=".SatoriPushRegistrationJob"', MANIFEST)
        self.assertIn("android.permission.BIND_JOB_SERVICE", MANIFEST)

    def test_registration_checks_server_response_and_sends_device_id(self):
        self.assertIn('.put("deviceId", deviceId(context))', PUSH)
        self.assertIn('optBoolean("registered") == true) "REGISTERED"', PUSH)
        self.assertIn("safeError(status, body)", PUSH)
        self.assertNotIn("connection.responseCode\n", PUSH)  # old ignored response

    def test_data_message_and_synthetic_test_are_handled(self):
        handler = PUSH.split("override fun onMessageReceived", 1)[1].split("override fun onNewToken", 1)[0]
        self.assertIn('"owner_push_test"', handler)
        self.assertIn('message.data["type"] != "verified_new_invoice"', handler)

    def test_single_notification_per_invoice_and_lock_screen_privacy(self):
        self.assertIn("fun markNotified(", PUSH)
        self.assertIn("if (!markNotified(context, number)) return", PUSH)
        self.assertIn("SatoriPush.markNotified(this, it)", MAIN)
        self.assertIn("setPublicVersion(publicVersion(context))", PUSH)
        self.assertIn("Có đơn hàng mới · mở khóa để xem", MAIN)
        self.assertIn("Notification.VISIBILITY_PRIVATE", MAIN)

    def test_channel_high_importance_and_never_reenabled(self):
        self.assertIn("NotificationManager.IMPORTANCE_HIGH", PUSH)
        self.assertIn("if (manager.getNotificationChannel(CHANNEL) != null) return", PUSH)
        self.assertIn("enableVibration(true)", PUSH)

    def test_tap_opens_exact_invoice(self):
        self.assertIn('putExtra(EXTRA, number)', PUSH)
        self.assertIn('"vn.minhsatori.app.OPEN_NEW_INVOICE"', PUSH)
        self.assertIn("queueInvoiceFromNotification(intent)", MAIN)

    def test_bell_off_revokes_and_diagnostics_exist_without_secrets(self):
        self.assertIn("SatoriPush.revokeOwnerDevice(this@NativeMainActivity)", MAIN)
        self.assertIn("private fun showPushDiagnostics()", MAIN)
        self.assertIn("Chẩn đoán thông báo đẩy (Push)", MAIN)
        diag = PUSH.split("fun localDiagnostics", 1)[1].split("fun fetchServerStatus", 1)[0]
        self.assertIn("takeLast(6)", PUSH)
        self.assertNotIn("getString(\"token\"", PUSH)
        self.assertNotIn("Log.", PUSH)
        for label in ["Firebase", "FCM Token", "Notification permission", "Channel", "Last push received"]:
            self.assertIn(label, diag)

    def test_release_refuses_push_required_build_without_firebase_vars(self):
        self.assertTrue(REQUEST.get("requiresFcm"))
        self.assertGreater(REQUEST["versionCode"], 71)
        self.assertIn("Refuse a push-required release without public Firebase config", RELEASE_WF)
        self.assertIn('req.get("requiresFcm") is True', RELEASE_WF)


if __name__ == "__main__":
    unittest.main()
