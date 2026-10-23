"""Static regression guard for owner-requested refresh recovery.

These checks run in the existing GitHub Android build job before Gradle.
Runtime behavior is additionally compiled by the Android unit-test job.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
ACTIVITY = ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt"


class LiveRefreshContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.code = ACTIVITY.read_text(encoding="utf-8")

    def test_refresh_is_always_in_header(self):
        self.assertIn('text = "↻ Refresh"', self.code)
        self.assertIn('contentDescription = "Refresh trang và đồng bộ hóa đơn ngay từ server"', self.code)
        self.assertIn('setOnClickListener { refreshNow() }', self.code)
        self.assertLess(self.code.index('setOnClickListener { refreshNow() }'),
                        self.code.index('val data = snapshot'))

    def test_manual_refresh_skips_version_probe(self):
        refresh = self.code.split("private fun refreshNow() {", 1)[1].split(
            "private fun syncPreferredSource()", 1
        )[0]
        self.assertIn("authorizationDeclined = false", refresh)
        self.assertIn("lastSyncAttemptElapsedMs = 0L", refresh)
        self.assertIn("syncPreferredSource()", refresh)
        self.assertNotIn("checkDriveVersion()", refresh)
        self.assertNotIn("checkMobileRevision()", refresh)

    def test_old_file_snapshot_transitions_to_live(self):
        self.assertIn("live_sync_source_migrated_v043", self.code)
        self.assertIn('putString("satori_source_mode", AutoSyncPolicy.DRIVE)',
                      self.code)
        self.assertIn('putBoolean("google_drive_auto_read", true)', self.code)

    def test_revision_probe_has_short_periodic_full_read(self):
        self.assertIn("syncIntervalMs = 20_000L", self.code)
        self.assertIn("fallbackReadMs = 120_000L", self.code)
        self.assertEqual(len(re.findall(
            r"SystemClock\.elapsedRealtime\(\), fallbackReadMs\)\)", self.code)), 4)
        self.assertNotIn("fallbackReadMs * 10", self.code)


if __name__ == "__main__":
    unittest.main()
