package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class AutoSyncPolicyTest {
    @Test fun firstLaunchDefaultsToLiveDriveWithoutManualButton() {
        assertEquals(AutoSyncPolicy.DRIVE, AutoSyncPolicy.source("", false, false))
        assertEquals(AutoSyncPolicy.DRIVE, AutoSyncPolicy.source(null, false, true))
    }
    @Test fun manualSourcesSurviveAppRestart() {
        assertEquals(AutoSyncPolicy.FILE, AutoSyncPolicy.source("file", true, true))
        assertEquals(AutoSyncPolicy.MOBILE_API, AutoSyncPolicy.source("api", true, true))
        assertEquals(AutoSyncPolicy.DRIVE, AutoSyncPolicy.source("drive", true, true))
    }
    @Test fun missingSavedPermissionsFailBackToDriveInsteadOfDemo() {
        assertEquals(AutoSyncPolicy.DRIVE, AutoSyncPolicy.source("api", false, false))
        assertEquals(AutoSyncPolicy.DRIVE, AutoSyncPolicy.source("file", false, true))
    }
    @Test fun throttlesForegroundRetriesAndAllowsClockReset() {
        assertTrue(AutoSyncPolicy.due(0, 100, 120000))
        assertFalse(AutoSyncPolicy.due(100, 100001, 120000))
        assertTrue(AutoSyncPolicy.due(100, 120100, 120000))
        assertTrue(AutoSyncPolicy.due(100000, 1, 120000))
    }
}
