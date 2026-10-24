"""Regression checks for owner's read-only Drive file and refresh on Samsung."""
from pathlib import Path
import unittest

SRC = (Path(__file__).resolve().parent.parent /
       "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")

class DriveFileForegroundSyncTests(unittest.TestCase):
    def test_persist_selected_file_prioritizes_real_ledger(self):
        self.assertIn('.putString("satori_source_mode", "file")', SRC)
        self.assertIn('AutoSyncPolicy.FILE -> refreshFromPicker()', SRC)
        self.assertIn('fileUri != null, apiEndpoint != null', SRC)
        self.assertIn('.putBoolean("google_drive_auto_read", false).apply()', SRC)

    def test_foreground_sync_reloads_file_without_oauth_token(self):
        tick=SRC.split('private val syncTick = object : Runnable {',1)[1].split('private fun hasServerAction',1)[0]
        self.assertIn('syncPreferredSource()',tick)
        self.assertIn('AutoSyncPolicy.due(',tick)
        self.assertNotIn('if (!isLoading && accessToken != null',tick)
        resume=SRC.split('override fun onResume()',1)[1].split('override fun onPause()',1)[0]
        self.assertIn('syncPreferredSource()',resume)
        self.assertNotIn('if (!isLoading && accessToken != null',resume)

    def test_auto_refresh_does_not_enable_write_permissions(self):
        self.assertIn('dataSource == "Minh Satori API" && allowedActions.contains(action)',SRC)
        self.assertIn('lastOnlineReadElapsedMs = SystemClock.elapsedRealtime()',SRC)
        self.assertIn('AutoSyncPolicy.FILE -> refreshFromPicker()',SRC)
        picker=SRC.split('private fun refreshFromPicker()',1)[1].split('private fun connectGoogle(automatic: Boolean = false',1)[0]
        self.assertIn('snapshot = null',picker)
        self.assertIn('lastOnlineReadElapsedMs = 0L',picker)

if __name__=="__main__":
    unittest.main()
