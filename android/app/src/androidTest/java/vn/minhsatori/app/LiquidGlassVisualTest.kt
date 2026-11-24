package vn.minhsatori.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.LayerDrawable
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Emulator only: clean install, no real credentials or financial records. */
@RunWith(AndroidJUnit4::class)
class LiquidGlassVisualTest {
    private fun views(root: View): Sequence<View> = sequence {
        yield(root)
        if (root is ViewGroup) for (i in 0 until root.childCount)
            yieldAll(views(root.getChildAt(i)))
    }
    @Test fun liquidDockAndDrawerUseRealNativeRoutes() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val prefs = context.getSharedPreferences("minh_satori_ui25d", Context.MODE_PRIVATE)
        val existed = prefs.contains("liquid_glass_v8")
        val previous = prefs.getBoolean("liquid_glass_v8", false)
        val viewport = InstrumentationRegistry.getArguments().getString("liquidViewport", "phone")
        require(viewport in setOf("phone", "fold-open", "fold-closed"))
        prefs.edit().putBoolean("liquid_glass_v8", true).commit()
        val activity = inst.startActivitySync(Intent(context, NativeMainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as NativeMainActivity
        fun capture(name: String) {
            inst.waitForIdleSync()
            SystemClock.sleep(450)
            val shot = inst.uiAutomation.takeScreenshot()
            assertNotNull("Screenshot unavailable", shot)
            val output = File(context.filesDir, "liquid-$viewport-$name.png")
            output.outputStream().use { assertTrue(shot!!.compress(Bitmap.CompressFormat.PNG, 100, it)) }
            assertTrue(output.length() > 5000L)
        }
        try {
            inst.waitForIdleSync()
            inst.runOnMainSync {
                assertTrue(SatoriUiTheme.liquid(activity))
                val root = activity.window.decorView
                assertTrue(views(root).any { it.isShown && it.contentDescription == "Mở Trang chủ" })
                assertTrue(views(root).any { it.isShown && it.isSelected && it.background is LayerDrawable })
            }
            capture("dock")
            inst.runOnMainSync {
                val menu = views(activity.window.decorView).first {
                    it.isShown && it.contentDescription == "Mở menu tác vụ"
                }
                assertTrue(menu.performClick())
            }
            inst.waitForIdleSync()
            SystemClock.sleep(450)
            inst.runOnMainSync {
                assertTrue(views(activity.window.decorView).any {
                    it.isShown && it.contentDescription == "Mở mục Khách hàng"
                })
                assertTrue(views(activity.window.decorView).any {
                    it.isShown && it.contentDescription == "Tùy chỉnh giao diện, màu và độ nổi"
                })
            }
            capture("drawer")
        } finally {
            inst.runOnMainSync { activity.finish() }
            if (existed) prefs.edit().putBoolean("liquid_glass_v8", previous).commit()
            else prefs.edit().remove("liquid_glass_v8").commit()
        }
    }
}
