package vn.minhsatori.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AiSandboxResponseTest {
    @Test fun acceptedResponseIsReturned() {
        val body = JSONObject("""{"ok":true,"message":"Đã thêm vào giỏ","quote":{"quoteId":"a"}}""")
        assertSame(body, AiSandboxResponse.requireSuccess(body))
    }

    @Test fun errorResponseIsNotMistakenForAcceptedOrder() {
        val body = JSONObject("""{"ok":false,"error":"DRAFT_CONFLICT","message":"Giỏ hàng đã thay đổi"}""")
        val error = assertThrows(IllegalStateException::class.java) {
            AiSandboxResponse.requireSuccess(body)
        }
        assertEquals("Giỏ hàng đã thay đổi", error.message)
    }

    @Test fun missingOkCannotSilentlyDiscardCustomerMessage() {
        assertThrows(IllegalStateException::class.java) {
            AiSandboxResponse.requireSuccess(JSONObject("""{"quote":null}"""))
        }
    }

    @Test fun longUntrustedResponseIsLimited() {
        val body = JSONObject().put("ok", false).put("message", "x".repeat(10000))
        val message = assertThrows(IllegalStateException::class.java) {
            AiSandboxResponse.requireSuccess(body)
        }.message!!
        assertTrue(message.length < 100)
    }
}
