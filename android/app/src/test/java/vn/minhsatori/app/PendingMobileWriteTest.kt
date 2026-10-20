package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import javax.crypto.KeyGenerator

class PendingMobileWriteTest {
    private val server = "https://script.google.com/macros/s/EXAMPLE_SANDBOX_ONLY/exec"
    private fun pending(action: String = "orders.create", extra: JSONObject = JSONObject()) =
        PendingMobileWrite(server, "verified-google-sub", action,
            extra.put("requestId", "persisted-request-001").put("expectedRevision", 105).toString(), 123L)

    private fun snapshot(order: JSONObject): SatoriSnapshot = SatoriData.fromDriveState(
        JSONObject().put("revision", 106).put("values", JSONObject()
            .put("satori_orders_v15", JSONArray().put(order).toString())).toString())

    private fun bill() = JSONObject().put("id", "branch-a-order").put("invoiceNo", 99)
        .put("name", "Khách thử").put("total", 20000).put("status", "Chưa thanh toán")

    @Test fun processRestartKeepsOriginalRequestRevisionAndVietnamesePayload() {
        val old = pending(extra = JSONObject().put("order", JSONObject()
            .put("name", "Hà Minh Nguyệt").put("deliveryNote", "Giao ngày mai\nKhông gọi nhầm điểm giao")))
        val reopened = PendingMobileWrite.decode(old.encode())
        assertEquals(old, reopened)
        assertEquals(105L, reopened.payload.getLong("expectedRevision"))
        assertTrue(reopened.matches(server, "verified-google-sub", old.action, old.payload))
    }

    @Test fun anotherAccountServerOrChangedPayloadCannotResumeTheOperation() {
        val old = pending()
        assertFalse(old.matches(server, "different-staff-sub", old.action, old.payload))
        assertFalse(old.matches(server + "-other", old.actorId, old.action, old.payload))
        assertFalse(old.matches(server, old.actorId, old.action,
            old.payload.put("expectedRevision", 106)))
    }

    @Test fun committedRequestIsDetectedAfterLostReply() {
        for ((action, field) in listOf("orders.create" to "apiRequestId",
            "orders.update" to "apiUpdateRequestId", "orders.restore" to "apiRestoreRequestId")) {
            val old = pending(action)
            assertTrue(old.confirmedIn(snapshot(bill().put(field, old.requestId))))
            assertFalse(old.confirmedIn(snapshot(bill().put(field, "another-request"))))
        }
    }

    @Test fun paymentRecoveryMustMatchIdInvoiceAndAmountNotJustName() {
        val old = pending("payments.markCustomerPaid", JSONObject().put("id", "branch-a-order")
            .put("invoiceNo", 99).put("amount", 20000))
        assertTrue(old.confirmedIn(snapshot(bill().put("status", "Đã thanh toán"))))
        assertFalse(old.confirmedIn(snapshot(bill().put("id", "branch-b-order").put("status", "Đã thanh toán"))))
        assertFalse(old.confirmedIn(snapshot(bill().put("total", 21000).put("status", "Đã thanh toán"))))
        assertFalse(old.confirmedIn(snapshot(bill())))
    }

    @Test fun deletionProofRequiresOriginalRequestAndExactInvoice() {
        val old = pending("orders.delete", JSONObject().put("id", "branch-a-order").put("invoiceNo", 99))
        val trash = JSONObject().put("orders", JSONArray().put(JSONObject()
            .put("id", "branch-a-order").put("invoiceNo", 99).put("deleteRequestId", old.requestId)))
        val empty = SatoriSnapshot(106, "", emptyList())
        assertTrue(old.confirmedIn(empty, trash))
        assertFalse(old.confirmedIn(empty))
        trash.getJSONArray("orders").getJSONObject(0).put("deleteRequestId", "different-request")
        assertFalse(old.confirmedIn(empty, trash))
    }

    @Test fun encryptedOutboxRoundtripHidesCustomerAndTokenIsNotStored() {
        val generator = KeyGenerator.getInstance("AES").apply { init(256) }
        val key = generator.generateKey()
        val old = pending(extra = JSONObject().put("name", "Khách cực kỳ riêng tư"))
        val encrypted = PendingWriteEnvelope.seal(old, key)
        assertFalse(String(encrypted, Charsets.UTF_8).contains("Khách"))
        assertFalse(old.encode().contains("accessToken"))
        assertEquals(old, PendingWriteEnvelope.open(encrypted, key))
        assertFalse(encrypted.contentEquals(PendingWriteEnvelope.seal(old, key)))
    }

    @Test fun tamperingWrongKeyAndOversizedDataFailClosed() {
        val generator = KeyGenerator.getInstance("AES").apply { init(256) }
        val key = generator.generateKey()
        val encrypted = PendingWriteEnvelope.seal(pending(), key)
        assertFails { PendingWriteEnvelope.open(encrypted, generator.generateKey()) }
        val json = JSONObject(String(encrypted, Charsets.UTF_8))
        val data = json.getString("data")
        json.put("data", (if (data[0] == 'A') "B" else "A") + data.substring(1))
        assertFails { PendingWriteEnvelope.open(json.toString().toByteArray(Charsets.UTF_8), key) }
        assertFails { PendingWriteEnvelope.open(ByteArray(400001), key) }
    }

    @Test fun unknownJournalVersionAndMissingIdentityAreRejected() {
        assertFails { PendingMobileWrite.decode(JSONObject(pending().encode()).put("version", 2).toString()) }
        assertFails { pending().copy(actorId = "") }
        assertFails { pending().copy(payloadJson = "{}") }
    }

    private fun assertFails(block: () -> Unit) {
        try { block() } catch (_: Exception) { return }
        fail("Expected an invalid or unauthenticated journal to fail closed")
    }
}
