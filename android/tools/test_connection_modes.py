"""Guard against silent Android connection-dialog and Drive scope regressions."""
import unittest
from pathlib import Path

SOURCE = (Path(__file__).resolve().parent.parent /
          "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")


class ConnectionModeTests(unittest.TestCase):
    def test_dialog_shows_choices_instead_of_message(self):
        block = SOURCE.split("private fun showConnectionSettings()", 1)[1].split("private fun render()", 1)[0]
        self.assertIn(".setItems(items)", block)
        self.assertNotIn(".setMessage(", block)
        self.assertIn("Google Drive — xem hóa đơn thật (chỉ đọc)", block)
        self.assertIn('putBoolean("google_drive_auto_read", true)', block)
        self.assertIn("snapshot = null", block)
        self.assertIn("connectGoogle()", block)

    def test_drive_oauth_not_lost_with_saved_sandbox_api(self):
        block = SOURCE.split("private fun connectGoogle()", 1)[1].split("private fun applyAuthorization", 1)[0]
        self.assertIn("apiEndpoint == null || preferGoogleDrive()", block)
        self.assertIn("https://www.googleapis.com/auth/drive.readonly", block)
        auth = SOURCE.split("private fun applyAuthorization", 1)[1].split("private fun refreshFromDrive", 1)[0]
        self.assertIn("if (preferGoogleDrive() || apiEndpoint == null) refreshFromDrive()", auth)
        self.assertIn('result.grantedScopes.contains("https://www.googleapis.com/auth/drive.readonly")', auth)

    def test_writes_remain_server_scoped(self):
        self.assertIn('dataSource == "Minh Satori API" && allowedActions.contains(action)', SOURCE)


if __name__ == "__main__":
    unittest.main()
