package vn.minhsatori.app

import android.content.Intent
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Exercises ALL Accounting Pro native dialogs on a clean emulator, with only
 * synthetic in-memory invoices. Never authorizes Google, opens a real ledger,
 * calls an order/payment endpoint or touches the owner's installed APK.
 *
 * The production app path has no test bypass: the intent guard is DEBUG-only.
 */
@RunWith(AndroidJUnit4::class)
class AccountingProScreensInstrumentedTest {
    private val ins get() = InstrumentationRegistry.getInstrumentation()

    private fun demoInvoice(
        id: String, number: String,
        status: String = "Chưa thanh toán",
        pairRole: String = "", pairNo: String = ""
    ) = SatoriInvoice(
        id = id,
        number = number,
        date = "2026-10-30",
        customer = "DEMO KHÁCH " + number,
        phone = "0900000000",
        address = "Địa chỉ DEMO",
        status = status,
        total = if (pairRole == "collaborator") 650_000L else 800_000L,
        shipping = 0L,
        vat = 0L,
        lines = listOf(SatoriLine("Nước suối DEMO", 10, "thùng", 80_000L, 100_000L)),
        deliveryNote = "",
        customerPaidAt = "",
        duplicateFrom = "",
        pairRole = pairRole,
        pairGroupId = if (pairRole.isNotBlank()) "DEMO-PAIR" else "",
        pairInvoiceNo = pairNo,
        collaboratorId = if (pairRole.isNotBlank()) "DEMO-CTV" else "",
        pairCollaboratorName = if (pairRole == "customer") "CTV DEMO" else ""
    )

    private fun fixture() = SatoriSnapshot(
        revision = 1L,
        updatedAt = "2026-10-30T00:00:00Z",
        invoices = listOf(
            demoInvoice("DEMO-CUSTOMER", "990001", pairRole = "customer", pairNo = "990002"),
            demoInvoice("DEMO-CTV-REFERENCE", "990002",
                pairRole = "collaborator", pairNo = "990001"),
            demoInvoice("DEMO-PAID", "990003", status = "Đã thanh toán")
        )
    )

    private fun open(
        activity: NativeMainActivity,
        functionName: String,
        data: SatoriSnapshot? = null
    ) {
        val parameterTypes = if (data == null) emptyArray<Class<*>>()
            else arrayOf(SatoriSnapshot::class.java)
        val method = NativeMainActivity::class.java.getDeclaredMethod(
            functionName, *parameterTypes
        ).apply { isAccessible = true }
        ins.runOnMainSync {
            if (data == null) method.invoke(activity) else method.invoke(activity, data)
        }
        ins.waitForIdleSync()
    }

    private fun assertDialogVisible(title: String) {
        repeat(8) {
            val root = ins.uiAutomation.rootInActiveWindow
            val matches = root?.findAccessibilityNodeInfosByText(title).orEmpty()
            if (matches.any { it.text?.toString()?.contains(title) == true }) return
            Thread.sleep(200)
        }
        fail("Expected Accounting Pro dialog not visible: $title")
    }

    @Test fun everyAccountingProScreenOpensAndClosesWithSyntheticData() {
        val intent = Intent(ins.targetContext, NativeMainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("ACCOUNTING_PRO_HERMETIC_TEST", true)
        val activity = ins.startActivitySync(intent) as NativeMainActivity
        try {
            val snapshot = fixture()
            val cases = listOf(
                Triple("showAccountingProPreview", "Minh Satori · Accounting Pro", true),
                Triple("showAccountingProInvoiceList", "Accounting Pro · Tra cứu công nợ", true),
                Triple("showAccountingProReviewAlerts", "Accounting Pro · Cảnh báo", true),
                Triple("showAccountingProProfitAudit", "Accounting Pro · CTV", true),
                Triple("showAccountingProBankDemo", "Accounting Pro · Bank DEMO", false),
                Triple("showAccountingProDocuments", "Accounting Pro · Chứng từ", true),
                Triple("showAccountingProAllocationDemo", "Accounting Pro · DEMO", false)
            )
            for ((function, title, hasData) in cases) {
                open(activity, function, if (hasData) snapshot else null)
                assertDialogVisible(title)
                ins.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
                ins.waitForIdleSync()
                assertTrue("Activity closed unexpectedly after $function",
                    !activity.isFinishing && !activity.isDestroyed)
            }
        } finally {
            ins.runOnMainSync { activity.finish() }
            ins.waitForIdleSync()
        }
    }
}
