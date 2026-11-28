package vn.minhsatori.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Fake invoice only; measures the real native renderer on a real Android density. */
@RunWith(AndroidJUnit4::class)
class WebsiteInvoicePdfSizeInstrumentedTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun fakeInvoice(): SatoriInvoice {
        val items = JSONArray()
        repeat(6) { i ->
            items.put(JSONObject().put("product", "Nước Giả $i").put("unit", "Thùng")
                .put("qty", 2).put("unitPrice", 95000).put("listPrice", 120000))
        }
        val order = JSONObject().put("id", 1).put("invoiceNo", 999991).put("date", "14/11/2026")
            .put("name", "KHÁCH GIẢ LẬP").put("phone", "0900000000").put("location", "01 Đường Giả")
            .put("status", "Chưa thanh toán").put("total", 1170000).put("shippingAmount", 30000)
            .put("items", items)
        val root = JSONObject().put("revision", 1).put("values",
            JSONObject().put("satori_orders_v15", JSONArray().put(order).toString()))
        return SatoriData.fromDriveState(root.toString()).invoices.single()
    }

    @Test
    fun sharedInvoicePdfIsSmall() {
        val file = File(context.cacheDir, "size-test-${System.nanoTime()}.pdf")
        try {
            WebsiteInvoicePdf.render(context, fakeInvoice(), file)
            val bytes = file.readBytes()
            assertTrue("not a PDF", String(bytes, 0, 5, Charsets.US_ASCII) == "%PDF-")
            android.util.Log.i("SatoriPdfSize", "bytes=" + bytes.size +
                " density=" + context.resources.displayMetrics.density)
            // Was ~4.7 MB on Samsung. Logo + QR at 3x print size stay far below this.
            assertTrue("PDF too large: ${bytes.size} bytes", bytes.size < 600_000)
        } finally { file.delete() }
    }
}
