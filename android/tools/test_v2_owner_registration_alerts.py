"""Source regression for registration notifications in the installed Minh Satori app."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
OWNER=(ROOT/"app/src/main/java/vn/minhsatori/app/AiCustomerPortalActivity.kt").read_text(encoding="utf-8")
SERVICE=(ROOT/"app/src/main/java/vn/minhsatori/app/V2RegistrationAlerts.kt").read_text(encoding="utf-8")
NATIVE=(ROOT/"app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
MANIFEST=(ROOT/"app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
class RegistrationNotificationTests(unittest.TestCase):
    def test_owner_only_signed_session_bell_and_badge(self):
        self.assertIn("verifyOwnerSession(cookies)",OWNER)
        self.assertIn('optBoolean("isAdmin") == true',OWNER)
        self.assertIn("V2RegistrationAlerts.schedule(this)",OWNER)
        self.assertIn("V2RegistrationAlerts.fetch(cookie)",OWNER)
        self.assertIn("V2RegistrationAlerts.process(applicationContext,feed)",OWNER)
        self.assertIn("updateRegistrationBadge(",OWNER)
        self.assertIn("R.drawable.ic_satori_bell",OWNER)
        self.assertIn("alertHandler.postDelayed(this,25_000L)",OWNER)
        self.assertIn("onPause()",OWNER)
        self.assertIn("onDestroy()",OWNER)
        self.assertIn("POST_NOTIFICATIONS",OWNER)
        self.assertIn("pendingV2=V2RegistrationAlerts.pendingCount(this)",NATIVE)

    def test_notification_channel_has_sound_and_background_scheduler(self):
        self.assertIn('"/api/v2/admin/notifications"',SERVICE)
        self.assertIn("satori_owner_registrations",SERVICE)
        self.assertIn("NotificationManager.IMPORTANCE_HIGH",SERVICE)
        self.assertIn("DEFAULT_NOTIFICATION_URI",SERVICE)
        self.assertIn("setShowBadge(true)",SERVICE)
        self.assertIn("setPeriodic(15*60*1000L)",SERVICE)
        self.assertIn("class V2RegistrationAlertJob:JobService()",SERVICE)
        self.assertIn("android.permission.BIND_JOB_SERVICE",MANIFEST)
        self.assertIn("android:name=\".V2RegistrationAlertJob\"",MANIFEST)

    def test_security_and_no_duplicate_alerts(self):
        self.assertIn('if(c.responseCode!=200)return null',SERVICE)
        self.assertIn('CookieManager.getInstance().getCookie(ORIGIN)',SERVICE)
        self.assertIn("getStringSet(\"seen_hashes\"",SERVICE)
        self.assertIn('digest(id.toByteArray(Charsets.UTF_8))',SERVICE)
        self.assertIn('if(initialized)feed.items.filter{it.first !in previous}',SERVICE)
        self.assertIn("getSharedPreferences(PREF,Context.MODE_PRIVATE)",SERVICE)
        self.assertNotIn("putString(\"cookie\"",SERVICE)
        self.assertNotIn("SATORI_BOT_SECRET",SERVICE)
        self.assertNotIn("setContentText(email",SERVICE)

if __name__=="__main__":
    unittest.main()
