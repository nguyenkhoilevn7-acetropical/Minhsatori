package vn.minhsatori.app

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/**
 * Isolated emulator-only screenshot. No production invoice, OAuth token or API writes.
 * Reflection invokes the SAME private openInvoice() shared by all real entrypoints.
 */
@RunWith(AndroidJUnit4::class)
class FullscreenInvoiceVisualTest {
    @Test fun captureFullscreenInvoiceFromRealNativeRenderer() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val intent = Intent(context, NativeMainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = inst.startActivitySync(intent) as NativeMainActivity
        val sample = SatoriInvoice(
            id = "", number = "9000", date = "02/11/2026",
            customer = "Khách kiểm thử giao diện", phone = "0900000000",
            address = "Địa chỉ minh họa, không phải đơn hàng thật",
            status = "Chưa thanh toán", total = 702000L, shipping = 0L,
            vat = 52000L, lines = listOf(
                SatoriLine("Nước tinh khiết (dữ liệu giả)", 10, "Thùng",
                    65000L, 65000L)
            ), deliveryNote = "Chỉ kiểm tra bố cục và nút Đóng",
            customerPaidAt = "", duplicateFrom = "", isTest = true
        )
        inst.runOnMainSync {
            val method = NativeMainActivity::class.java.getDeclaredMethod(
                "openInvoice", SatoriInvoice::class.java)
            method.isAccessible = true
            method.invoke(activity, sample)
        }
        inst.waitForIdleSync()
        SystemClock.sleep(650)
        val shot = inst.uiAutomation.takeScreenshot()
        assertTrue("Fullscreen screenshot unavailable", shot != null)
        val folder = context.getExternalFilesDir(null)!!
        val out = File(folder, "ui25d-invoice-fullscreen.png")
        FileOutputStream(out).use { stream ->
            assertTrue(shot.compress(Bitmap.CompressFormat.PNG, 100, stream))
        }
        assertTrue(out.length() > 5000L)
        inst.runOnMainSync { activity.finish() }
    }
}
