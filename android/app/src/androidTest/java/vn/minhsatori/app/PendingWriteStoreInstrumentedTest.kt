package vn.minhsatori.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import java.util.UUID

/** Uses unique fake journals and keys, never the application's business outbox. */
@RunWith(AndroidJUnit4::class)
class PendingWriteStoreInstrumentedTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var name: String
    private lateinit var alias: String
    private lateinit var pending: PendingMobileWrite
    private fun store() = PendingWriteStore(context, name, alias)
    private fun base() = File(context.noBackupFilesDir, name)

    @Before fun setup() {
        val id = UUID.randomUUID().toString()
        name = "TEST_ONLY_$id.aes"
        alias = "minhsatori.test.$id"
        pending = PendingMobileWrite("https://script.google.com/macros/s/TEST_SANDBOX_ONLY/exec",
            "fake-google-sub", "orders.create",
            """{"requestId":"fake-request-00001","expectedRevision":1,"order":{"name":"Khách thử riêng tư","total":20000}}""", 1)
    }

    @After fun cleanupTestFilesOnly() {
        for (suffix in listOf("", ".new", ".bak")) File(base().path + suffix).delete()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    }

    @Test fun newStoreInstanceRecoversEncryptedOperationAndClearsAfterProof() {
        store().save(pending)
        assertEquals(pending, store().load())
        assertFalse(base().readText().contains("Khách thử"))
        store().save(pending) // retry preserves exact journal
        store().clear(pending)
        assertNull(store().load())
    }

    @Test fun differentOperationCannotOverwriteOrDeleteOriginal() {
        store().save(pending)
        val changed = pending.copy(createdAt = 2)
        assertFails { store().save(changed) }
        assertFails { store().clear(changed) }
        assertEquals(pending, store().load())
    }

    @Test fun missingDeviceKeyRetainsFileAndNeverRegeneratesForExistingJournal() {
        store().save(pending)
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        assertFails { store().load() }
        assertFails { store().save(pending) }
        assertTrue(base().exists())
        assertFalse(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(alias))
    }

    @Test fun corruptedJournalFailsClosedAndRemainsAvailableForInvestigation() {
        store().save(pending)
        base().writeText("corrupted-test-data")
        assertFails { store().load() }
        assertFails { store().save(pending) }
        assertEquals("corrupted-test-data", base().readText())
    }

    private fun assertFails(block: () -> Unit) {
        try { block() } catch (_: Exception) { return }
        fail("Expected protected journal operation to fail closed")
    }
}
