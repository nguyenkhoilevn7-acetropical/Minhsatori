package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

/** Pure contract tests: no real network calls, OAuth, Drive or production orders. */
class AiSandboxContractTest {
    private fun line(code: String="TP-00003", n: Int=2)=
        AiSandboxContract.Line(code, "Nước tinh khiết Satori 500ml", "Thùng", n)

    @Test fun acceptsOnlySandboxInvoiceReferenceForPdf() {
        assertTrue(AiSandboxContract.validTestRef("TEST-012345ABCD"))
        assertFalse(AiSandboxContract.validTestRef("1234"))
        assertFalse(AiSandboxContract.validTestRef("TEST-../../api"))
        assertFalse(AiSandboxContract.validTestRef("TEST-abcdef1234"))
        assertFalse(AiSandboxContract.validTestRef(""))
    }

    @Test fun pinnedHttpsHostOnly() {
        assertTrue(AiSandboxContract.validEndpoint(AiSandboxContract.BASE_URL))
        for (url in listOf(
            "http://minh-satori-customer-ai-gemini.onrender.com",
            "https://evil.com",
            "https://minh-satori-customer-ai-gemini.onrender.com.evil.com",
            "https://minh-satori-customer-ai-gemini.onrender.com:8443",
            "https://user@minh-satori-customer-ai-gemini.onrender.com",
            "https://minh-satori-customer-ai-gemini.onrender.com?token=secret",
            "https://minh-satori-customer-ai-gemini.onrender.com/somepage"
        )) assertFalse(url, AiSandboxContract.validEndpoint(url))
    }

    @Test fun composedCartHasEverySkuAndQty() {
        val lines = listOf(line(), line("TP-00056", 3), line("TP-00081", 5))
        val message = AiSandboxContract.cartMessage(lines)
        assertTrue(message.startsWith("Cho tôi đặt một đơn gồm:\n"))
        assertTrue(message.contains("TP-00003"))
        assertTrue(message.contains("TP-00056"))
        assertTrue(message.contains("TP-00081"))
        assertTrue(message.contains("- 5 Thùng"))
        val payload = AiSandboxContract.requestMessage(message, lines)
        assertEquals("demo-a", payload.getString("token"))
        assertEquals(3, payload.getJSONArray("cartItems").length())
        assertEquals(5, payload.getJSONArray("cartItems").getJSONObject(2).getInt("qty"))
    }

    @Test fun oneLineStillWorks() {
        assertEquals(1, AiSandboxContract.requestMessage(
            AiSandboxContract.cartMessage(listOf(line())), listOf(line()))
            .getJSONArray("cartItems").length())
    }

    @Test fun plainChatNeverClaimsUnselectedItems() {
        val payload = AiSandboxContract.requestMessage("Xin chào")
        assertFalse(payload.has("cartItems"))
    }

    @Test fun modifiedTextCannotReuseOldCart() {
        val lines = listOf(line())
        assertThrows(IllegalArgumentException::class.java) {
            AiSandboxContract.requestMessage("Một sản phẩm khác", lines)
        }
    }

    @Test fun duplicateAndUnknownCodesFailClosed() {
        assertThrows(IllegalArgumentException::class.java) {
            AiSandboxContract.cartMessage(listOf(line(), line()))
        }
        assertThrows(IllegalArgumentException::class.java) {
            AiSandboxContract.cartMessage(listOf(line("TP-xxxxx")))
        }
    }

    @Test fun capSixProductsAndFiveHundredUnits() {
        val ok = (1..6).map { line("TP-" + it.toString().padStart(5,'0'), 1) }
        assertEquals(6, ok.size)
        assertTrue(AiSandboxContract.cartMessage(ok).length <= 500)
        assertThrows(IllegalArgumentException::class.java) {
            AiSandboxContract.cartMessage(ok+line("TP-00007"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            AiSandboxContract.cartMessage(listOf(line("TP-00003",300),line("TP-00004",201)))
        }
    }

    @Test fun emptyZeroAndExcessQtyRejected() {
        for (items in listOf(emptyList(),listOf(line(n=0)),listOf(line(n=501)))) {
            assertThrows(IllegalArgumentException::class.java) {
                AiSandboxContract.cartMessage(items)
            }
        }
    }

    @Test fun noLiveCustomerCredentialOrMerchantDataInContract() {
        assertEquals("demo-a", AiSandboxContract.PUBLIC_FIXTURE)
        assertTrue(AiSandboxContract.BASE_URL.contains("customer-ai-gemini"))
        val message=AiSandboxContract.requestMessage("Cho tôi 2 thùng 500ml")
        assertFalse(message.has("phone"))
        assertFalse(message.has("address"))
        assertFalse(message.has("bankAccount"))
    }
}
