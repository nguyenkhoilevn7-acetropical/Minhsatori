package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class AiSandboxDraftRecoveryTest {
    private val basket = listOf(
        AiSandboxContract.Line("TP-00001", "Satori 500ml", "thùng", 10),
        AiSandboxContract.Line("TP-00002", "Mãng cầu", "thùng", 5)
    )

    @Test fun recoveredMessagePreservesSelectedStructuredBasket() {
        val message = AiSandboxContract.cartMessage(basket)
        assertEquals(basket, AiSandboxDraftRecovery.restore(message, AiSandboxDraftRecovery.encode(basket)))
    }

    @Test fun editedTextNeverReusesStaleStructuredBasket() {
        val encoded = AiSandboxDraftRecovery.encode(basket)
        assertNull(AiSandboxDraftRecovery.restore("Cho 99 thùng khác", encoded))
        assertNull(AiSandboxDraftRecovery.restore(AiSandboxContract.cartMessage(basket), "not json"))
    }

    @Test fun malformedAndOversizedSavedCartIsDiscarded() {
        assertNull(AiSandboxDraftRecovery.restore("Hi", "x".repeat(5001)))
        assertNull(AiSandboxDraftRecovery.restore("Hi", "[]"))
        assertNull(AiSandboxDraftRecovery.restore("", AiSandboxDraftRecovery.encode(basket)))
    }
}
