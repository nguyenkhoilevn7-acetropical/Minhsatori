package vn.minhsatori.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class LiveSyncPolicyTest {
    @Test fun driveFileVersionIsParsedWithoutDownloadingOrders() {
        assertEquals(513L, LiveSyncPolicy.driveVersion("""{"version":"513","modifiedTime":"2026-10-23T15:00:00Z"}"""))
        assertTrue(LiveSyncPolicy.driveChanged(null, 513L))
        assertTrue(LiveSyncPolicy.driveChanged(513L, 514L))
        assertTrue(LiveSyncPolicy.driveChanged(514L, 513L))
        assertFalse(LiveSyncPolicy.driveChanged(513L, 513L))
    }

    @Test fun malformedOrMissingVersionFailsClosed() {
        for (value in listOf("{}", """{"version":"0"}""", """{"version":-1}""",
            """{"version":"banana"}""", """{"version":null}""", """{"version":{}}""", "not-json")) {
            assertFails { LiveSyncPolicy.driveVersion(value) }
        }
    }

    @Test fun mobileRevisionRefreshesOnlyWhenCanonicalLedgerChanges() {
        val valid = JSONObject().put("revision", 133)
            .put("ledgerFileId", DriveReadClient.LIVE_FILE_ID)
            .put("ledgerKind", LiveSyncPolicy.PRODUCTION_LEDGER_KIND)
        assertEquals(133L, LiveSyncPolicy.mobileRevision(valid))
        assertFalse(LiveSyncPolicy.mobileChanged(133L, 133L))
        assertTrue(LiveSyncPolicy.mobileChanged(133L, 134L))
        assertTrue(LiveSyncPolicy.mobileChanged(134L, 133L))
        for (bad in listOf("{}", """{"revision":-1}""", """{"revision":"?!"}""",
            """{"revision":1}""", """{"revision":132}""",
            """{"revision":134,"ledgerFileId":"sandbox","ledgerKind":"minh-satori-owner-drive-v15"}""",
            """{"revision":134,"ledgerFileId":"14XWSPrxLnKXATwmuHeXGZnCvjDbalghV"}""")) {
            assertFails { LiveSyncPolicy.mobileRevision(JSONObject(bad)) }
        }
    }

    @Test fun snapshotRejectsWrongEnvelopeRevisionAndFakeLedger() {
        val data = JSONObject().put("revision", 134)
            .put("ledgerFileId", DriveReadClient.LIVE_FILE_ID)
            .put("ledgerKind", LiveSyncPolicy.PRODUCTION_LEDGER_KIND)
        val empty = SatoriSnapshot(134, "", emptyList())
        assertFails { LiveSyncPolicy.validateMobileSnapshot(data, 134, empty) }
        assertFails { LiveSyncPolicy.validateMobileSnapshot(data, 133, empty) }
    }

    @Test fun neverReplacesVerifiedLedgerWithOlderRevision() {
        assertTrue(LiveSyncPolicy.canApplySnapshot(null, 132L))
        assertTrue(LiveSyncPolicy.canApplySnapshot(132L, 132L))
        assertTrue(LiveSyncPolicy.canApplySnapshot(132L, 133L))
        assertFalse(LiveSyncPolicy.canApplySnapshot(132L, 131L))
        assertFalse(LiveSyncPolicy.canApplySnapshot(null, -1L))
    }

    private fun assertFails(operation: () -> Unit) {
        try { operation() } catch (_: Exception) { return }
        fail("Malformed or regressing ledger version must fail closed")
    }
}
