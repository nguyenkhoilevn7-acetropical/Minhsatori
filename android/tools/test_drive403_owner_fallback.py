"""Fail-closed read-only recovery after Google Drive HTTP 403 on Samsung.

No real Google login, production data, customer details, or HMAC required.
Gradle/Android tests additionally compile the Kotlin implementation in CI.
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
ANDROID = ROOT / "app/src/main/java/vn/minhsatori/app"
MAIN = (ANDROID / "NativeMainActivity.kt").read_text(encoding="utf-8")
DRIVE = (ANDROID / "DriveReadClient.kt").read_text(encoding="utf-8")


class Drive403OwnerFallbackContract(unittest.TestCase):
    def test_explicit_drive_permission_error_from_both_api_calls(self):
        self.assertIn("internal class DriveReadPermissionDenied", DRIVE)
        self.assertEqual(DRIVE.count("403 -> throw DriveReadPermissionDenied()"), 2)

    def test_drive403_attempts_existing_owner_mobile_api(self):
        self.assertIn("private fun recoverDriveAccessUsingOwnerApi(token: String): Boolean", MAIN)
        self.assertIn("val endpoint = apiEndpoint ?: return false", MAIN)
        self.assertIn("MobileApiClient.snapshot(endpoint, token)", MAIN)
        self.assertGreaterEqual(MAIN.count("recoverDriveAccessUsingOwnerApi(token)"), 3)
        self.assertIn("error is DriveReadPermissionDenied", MAIN)

    def test_no_new_write_rights_granted_by_automatic_fallback(self):
        recover = MAIN.split("private fun recoverDriveAccessUsingOwnerApi(", 1)[1].split(
            "private fun checkDriveVersion()", 1
        )[0]
        self.assertIn('"mobile_owner_readonly_fallback", true', recover)
        self.assertIn('it.startsWith("mobile.")', recover)
        self.assertNotIn('allowedActions = remote.allowedActions\n', recover)
        self.assertIn('"mobile_owner_readonly_fallback", false', MAIN)

    def test_no_token_or_customer_data_written_to_preferences(self):
        recover = MAIN.split("private fun recoverDriveAccessUsingOwnerApi(", 1)[1].split(
            "private fun checkDriveVersion()", 1
        )[0]
        prefs = recover.split('getPreferences(MODE_PRIVATE).edit()', 1)[1].split('.apply()', 1)[0]
        self.assertNotIn("accessToken", prefs)
        self.assertNotIn("snapshot", prefs)
        self.assertNotIn("actorId", prefs)

    def test_google_scope_failure_tries_email_only_once(self):
        self.assertIn("emailOnlyFallback: Boolean = false", MAIN)
        self.assertIn("connectGoogle(automatic = true, emailOnlyFallback = true)", MAIN)
        self.assertIn("if (!emailOnlyFallback && apiEndpoint != null)", MAIN)
        self.assertIn("if (recoverDriveAccessUsingOwnerApi(token)) return", MAIN)

    def test_failure_retains_current_data_and_reports_exact_provider_error(self):
        self.assertIn("Drive từ chối quyền", MAIN)
        self.assertIn("Mobile API chủ sở hữu cũng chưa kết nối được", MAIN)
        self.assertIn("snapshot = remote.snapshot", MAIN)
        self.assertIn("LiveSyncPolicy.canApplySnapshot(prior.revision, remote.snapshot.revision)", MAIN)

    def test_explicit_reconnect_can_select_the_correct_google_account(self):
        self.assertIn("connectGoogle(askAccount = true)", MAIN)
        self.assertIn("AuthorizationRequest.Prompt.SELECT_ACCOUNT", MAIN)
        self.assertIn("if (askAccount) builder.setPrompt(", MAIN)
        # Timed background refresh must not repeatedly present sign-in dialogs.
        tick = MAIN.split("private val syncTick = object : Runnable", 1)[1].split(
            "private fun hasServerAction", 1
        )[0]
        self.assertNotIn("askAccount = true", tick)

    def test_sandbox_ledger_is_not_accepted_as_live(self):
        self.assertIn("remote.snapshot.invoices.isEmpty()", MAIN)
        self.assertIn("remote.snapshot.invoices.all { it.isTest }", MAIN)
        self.assertIn("Không được thay thế dữ liệu Minh Satori thật.", MAIN)

    def test_no_duplicate_stale_banner(self):
        self.assertIn("if (stale && connected) label(info, statusMessage", MAIN)


if __name__ == "__main__":
    unittest.main()
