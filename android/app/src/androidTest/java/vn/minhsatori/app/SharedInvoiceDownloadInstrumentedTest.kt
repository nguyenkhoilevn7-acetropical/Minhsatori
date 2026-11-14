package vn.minhsatori.app

import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Fake invoice bytes and a fake recipient only; deletes its own Downloads entry. */
@RunWith(AndroidJUnit4::class)
class SharedInvoiceDownloadInstrumentedTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val tag = UUID.randomUUID().toString().take(8)
    private val name = "999999 - KHÁCH GIẢ $tag - 2026-11-13.pdf"
    private var created: android.net.Uri? = null

    private fun fakePdf(body: String): File {
        val dir = File(context.cacheDir, "shared_invoices").apply { mkdirs() }
        return File(dir, name).apply { writeBytes(("%PDF-1.4\n" + body).toByteArray()) }
    }
    private fun read(uri: android.net.Uri) =
        context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }
    private fun column(uri: android.net.Uri, col: String) =
        context.contentResolver.query(uri, arrayOf(col), null, null, null)!!.use {
            it.moveToFirst(); it.getString(0)
        }

    @Test
    fun publishesExactCustomerNameAndOverwritesOnReshare() {
        val first = fakePdf("A".repeat(5000))
        val uri = SharedInvoiceDownload.publish(context, first)
        assertNotNull("API 29+ must publish to Downloads", uri)
        created = uri
        assertEquals(name, column(uri!!, MediaStore.MediaColumns.DISPLAY_NAME))
        assertEquals("Download/Minh Satori/", column(uri, MediaStore.MediaColumns.RELATIVE_PATH))
        assertEquals("application/pdf", context.contentResolver.getType(uri))
        assertArrayEquals(first.readBytes(), read(uri))

        // Same invoice shared again (shorter re-render): same entry, no "(1)", no stale tail.
        val second = fakePdf("B".repeat(10))
        val again = SharedInvoiceDownload.publish(context, second)
        assertEquals(uri, again)
        assertEquals(name, column(uri, MediaStore.MediaColumns.DISPLAY_NAME))
        assertArrayEquals(second.readBytes(), read(uri))
    }

    @After fun cleanup() {
        created?.let { context.contentResolver.delete(it, null, null) }
        File(File(context.cacheDir, "shared_invoices"), name).delete()
    }
}
