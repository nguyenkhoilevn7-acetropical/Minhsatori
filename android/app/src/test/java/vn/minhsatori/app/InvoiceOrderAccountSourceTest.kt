package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class InvoiceOrderAccountSourceTest {
    private fun bill(
        recipient: String = "Ngọc Ngô",
        collaborator: String = "",
        id: String = "1793954613776",
        number: String = "5978",
        source: String = "bot_api",
        requestId: String = "827b61d1-59bf-477d-9cec-92631d33ba4e"
    ) = SatoriInvoice(
        id = id, number = number, date = "06/11/2026",
        customer = recipient, phone = "000000000", address = "Điểm giao hàng",
        status = "Chưa thanh toán", total = 212296, shipping = 0, vat = 15726,
        lines = listOf(SatoriLine("Suối", 5, "Bình", 39314, 49143)),
        deliveryNote = "", customerPaidAt = "", duplicateFrom = "",
        collaboratorId = collaborator, source = source, requestId = requestId
    )

    private fun origin(
        invoice: SatoriInvoice = bill(),
        accountId: String = "v2-account-a",
        name: String = "Tài khoản A",
        role: String = "collaborator",
        roleSource: String = InvoiceOrderAccountSource.ROLE_FROM_ORDER
    ) = SatoriOrderOrigin(invoice.id, invoice.number, accountId, name, role, roleSource)

    private fun ledger(
        invoice: SatoriInvoice = bill(),
        origins: List<SatoriOrderOrigin> = emptyList(),
        collaborators: List<SatoriCollaborator> = emptyList()
    ) = SatoriSnapshot(231L, "", listOf(invoice), collaborators = collaborators,
        collaboratorRegistryLoaded = true, orderOrigins = origins)

    @Test fun verifiedAccountIsShownSeparatelyFromRecipient() {
        val invoice = bill()
        val display = InvoiceOrderAccountSource.resolve(invoice,
            ledger(invoice, listOf(origin(invoice))))
        assertTrue(display.verifiedLogin)
        assertEquals("Đặt từ: Tài khoản A · CTV", display.card)
        assertEquals("Tài khoản A", display.accountName)
        assertEquals("CTV", display.roleDetail)
        assertEquals("Ngọc Ngô", invoice.customer)
        assertFalse(display.card.contains("Ngọc Ngô"))
    }

    @Test fun allThreeRolesHaveDistinctLabels() {
        mapOf("collaborator" to "CTV", "agency" to "Đại Lý", "retail" to "Khách Lẻ")
            .forEach { (role, label) ->
                val invoice = bill()
                val display = InvoiceOrderAccountSource.resolve(invoice,
                    ledger(invoice, listOf(origin(invoice, role = role))))
                assertEquals("Đặt từ: Tài khoản A · $label", display.card)
                assertEquals(label, display.accountRole)
            }
    }

    @Test fun roleTakenFromCurrentProfileIsLabelledAsSuch() {
        val invoice = bill()
        for (source in listOf(InvoiceOrderAccountSource.ROLE_FROM_CURRENT_PROFILE, "", "x")) {
            val display = InvoiceOrderAccountSource.resolve(invoice,
                ledger(invoice, listOf(origin(invoice, roleSource = source))))
            assertTrue(display.verifiedLogin)
            assertFalse(display.roleFromOrder)
            assertEquals("Đặt từ: Tài khoản A · CTV (hồ sơ hiện tại)", display.card)
            assertEquals("CTV · " + InvoiceOrderAccountSource.CURRENT_PROFILE_NOTE,
                display.roleDetail)
        }
    }

    @Test fun unknownOrAliasRolesAreRejected() {
        for (role in listOf("owner", "admin", "ctv", "customer", "CTV", " collaborator", "")) {
            val invoice = bill()
            val display = InvoiceOrderAccountSource.resolve(invoice,
                ledger(invoice, listOf(origin(invoice, role = role))))
            assertFalse(role, display.verifiedLogin)
            assertEquals(InvoiceOrderAccountSource.UNKNOWN, display.card)
        }
    }

    @Test fun noRegistryMeansUnknownEvenWithCollaboratorLinkOrMatchingName() {
        val invoice = bill(recipient = "Tài khoản A", collaborator = "ctv1")
        val ctv = SatoriCollaborator("ctv1", "Tài khoản A", "000000000", 20.0)
        val display = InvoiceOrderAccountSource.resolve(invoice,
            ledger(invoice, collaborators = listOf(ctv)))
        assertFalse(display.verifiedLogin)
        assertEquals(InvoiceOrderAccountSource.UNKNOWN, display.card)
        assertEquals(InvoiceOrderAccountSource.UNKNOWN, display.detail)
        assertEquals("", display.roleDetail)
    }

    @Test fun nullSnapshotIsUnknown() {
        assertFalse(InvoiceOrderAccountSource.resolve(bill(), null).verifiedLogin)
    }

    @Test fun idAndNumberMustBothMatchExactly() {
        val invoice = bill()
        val wrongId = origin(invoice).copy(ledgerInvoiceId = "1793954613777")
        val wrongNo = origin(invoice).copy(invoiceNo = "5979")
        for (o in listOf(wrongId, wrongNo)) {
            assertFalse(InvoiceOrderAccountSource.resolve(invoice,
                ledger(invoice, listOf(o))).verifiedLogin)
        }
    }

    @Test fun duplicateOrConflictingRowsAreNeverDisplayed() {
        val invoice = bill()
        val a = origin(invoice)
        val conflicts = listOf(
            listOf(a, a),
            listOf(a, a.copy(accountId = "v2-account-b", accountName = "Tài khoản B")),
            // Same number reused by another ledger id, or same id with another number.
            listOf(a, a.copy(ledgerInvoiceId = "1793954613000")),
            listOf(a, a.copy(invoiceNo = "5990")))
        for (rows in conflicts) {
            val display = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice, rows))
            assertFalse(display.verifiedLogin)
            assertEquals(InvoiceOrderAccountSource.UNKNOWN, display.card)
        }
    }

    @Test fun blankIdentityOrAccountIsUnknown() {
        val invoice = bill()
        assertFalse(InvoiceOrderAccountSource.resolve(invoice,
            ledger(invoice, listOf(origin(invoice, accountId = "")))).verifiedLogin)
        assertFalse(InvoiceOrderAccountSource.resolve(invoice,
            ledger(invoice, listOf(origin(invoice, name = "")))).verifiedLogin)
        val noId = bill(id = "")
        assertFalse(InvoiceOrderAccountSource.resolve(noId,
            ledger(noId, listOf(origin(noId)))).verifiedLogin)
    }

    @Test fun inlineInvoiceFieldsCannotSelfDeclareTheOrderer() {
        val order = JSONObject()
            .put("id", 1793954613776L).put("invoiceNo", 5978)
            .put("date", "06/11/2026").put("name", "Ngọc Ngô")
            .put("orderedByAccountId", "typed-by-anyone")
            .put("orderedByName", "Tài khoản A")
            .put("orderedByRole", "collaborator")
            .put("total", 212296).put("vatAmount", 15726)
            .put("items", JSONArray().put(JSONObject().put("product", "Suối")
                .put("qty", 5).put("unitPrice", 39314).put("listPrice", 49143)))
        val state = JSONObject().put("revision", 231).put("values", JSONObject()
            .put("satori_orders_v15", JSONArray().put(order).toString()))
        val snapshot = SatoriData.fromDriveState(state.toString())
        val invoice = snapshot.invoices.single()
        assertEquals("Ngọc Ngô", invoice.customer)
        assertFalse(InvoiceOrderAccountSource.resolve(invoice, snapshot).verifiedLogin)
    }

    @Test fun registryParserKeepsRoleSourceAndNeverBreaksTheLedger() {
        fun raw(value: String) = JSONObject().put("revision", 231)
            .put("values", JSONObject()
                .put("satori_orders_v15", "[]")
                .put("satori_v2_order_origins_v1", value)).toString()
        val row = JSONObject()
            .put("ledgerInvoiceId", "1793954613776").put("invoiceNo", 5978)
            .put("accountId", "v2-account-a").put("accountName", "Tài khoản A")
            .put("accountRole", "collaborator").put("roleSource", "CURRENT_PROFILE")
        val parsed = SatoriData.fromDriveState(raw(JSONArray().put(row).toString()))
        assertEquals("5978", parsed.orderOrigins.single().invoiceNo)
        assertEquals("CURRENT_PROFILE", parsed.orderOrigins.single().roleSource)
        val malformed = SatoriData.fromDriveState(raw("not-json"))
        assertTrue(malformed.orderOrigins.isEmpty())
        assertTrue(malformed.invoices.isEmpty())
    }

    @Test fun oversizedIdentityIsRejectedRatherThanTruncatedIntoMatch() {
        val row = JSONObject().put("ledgerInvoiceId", "x".repeat(101)).put("invoiceNo", "5978")
            .put("accountId", "one").put("accountName", "Account A").put("accountRole", "retail")
        val state = JSONObject().put("revision", 231).put("values", JSONObject()
            .put("satori_orders_v15", "[]")
            .put("satori_v2_order_origins_v1", JSONArray().put(row).toString()))
        assertTrue(SatoriData.fromDriveState(state.toString()).orderOrigins.isEmpty())
    }

    private fun v2(invoice: SatoriInvoice, role: String = "collaborator",
                   requestId: String = invoice.requestId) =
        SatoriOrderOrigin(invoice.id, invoice.number, "v2-account-a", "Tài khoản A", role,
            InvoiceOrderAccountSource.ROLE_FROM_ORDER, requestId)

    @Test fun v2OwnerFeedVerifiesAccountWhenRequestIdMatchesBill() {
        val invoice = bill()
        val display = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice), listOf(v2(invoice)))
        assertTrue(display.verifiedLogin)
        assertEquals(InvoiceOrderAccountSource.Creator.V2_ACCOUNT, display.creator)
        assertEquals("Đặt từ: Tài khoản A · CTV", display.card)
    }

    @Test fun v2OwnerFeedWithDifferentRequestIdIsRejected() {
        val invoice = bill()
        val display = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice),
            listOf(v2(invoice, requestId = "00000000-0000-4000-8000-000000000000")))
        assertFalse(display.verifiedLogin)
        assertEquals(InvoiceOrderAccountSource.UNKNOWN, display.card)
    }

    @Test fun sameAccountFromBothFeedsCountsOnceButConflictIsUnknown() {
        val invoice = bill()
        val registry = origin(invoice, accountId = "v2-account-a", name = "Tài khoản A")
        assertTrue(InvoiceOrderAccountSource.resolve(invoice, ledger(invoice, listOf(registry)),
            listOf(v2(invoice))).verifiedLogin)
        val other = origin(invoice, accountId = "v2-account-b", name = "Tài khoản B")
        assertFalse(InvoiceOrderAccountSource.resolve(invoice, ledger(invoice, listOf(other)),
            listOf(v2(invoice))).verifiedLogin)
    }

    @Test fun chatGptBillsAreLabelledFromTheirRequestId() {
        val invoice = bill(requestId = "chatgpt-20261105-sample-01")
        val display = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice))
        assertFalse(display.verifiedLogin)
        assertEquals(InvoiceOrderAccountSource.Creator.CHATGPT, display.creator)
        assertEquals("Tạo bởi: ChatGPT", display.card)
    }

    @Test fun otherHandWrittenBotApiIdsAreAiAssistantNotChatGpt() {
        val invoice = bill(requestId = "hmn-20261024-sample")
        val display = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice))
        assertEquals(InvoiceOrderAccountSource.Creator.AI_BOT_API, display.creator)
        assertEquals("Tạo bởi: " + InvoiceOrderAccountSource.AI_BOT_API, display.card)
    }

    @Test fun uuidBotApiBillWithoutVerifiedAccountStaysUnknown() {
        val invoice = bill()
        val display = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice))
        assertEquals(InvoiceOrderAccountSource.Creator.V2_UNVERIFIED, display.creator)
        assertEquals(InvoiceOrderAccountSource.UNKNOWN, display.card)
    }

    @Test fun billsWithoutBotApiAreManual() {
        val invoice = bill(source = "", requestId = "")
        val display = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice))
        assertEquals(InvoiceOrderAccountSource.Creator.MANUAL, display.creator)
        assertEquals("Tạo bởi: " + InvoiceOrderAccountSource.MANUAL, display.card)
    }

    @Test fun ownerFeedParserAcceptsServerDocumentAndRejectsOthers() {
        val row = JSONObject().put("ledgerInvoiceId", "1793954613776").put("invoiceNo", "5978")
            .put("accountId", "v2-account-a").put("accountName", "Tài khoản A")
            .put("accountRole", "collaborator").put("roleSource", "ORDER_SNAPSHOT")
            .put("requestId", "827b61d1-59bf-477d-9cec-92631d33ba4e")
        val doc = JSONObject().put("ok", true).put("schemaVersion", 1)
            .put("source", "satori-v2-postgresql-committed").put("entries", JSONArray().put(row))
        val parsed = V2OrderOriginsClient.parse(doc.toString())!!
        assertEquals("827b61d1-59bf-477d-9cec-92631d33ba4e", parsed.single().requestId)
        assertNull(V2OrderOriginsClient.parse(JSONObject(doc.toString()).put("source", "x").toString()))
        assertNull(V2OrderOriginsClient.parse(JSONObject(doc.toString()).put("ok", false).toString()))
        assertNull(V2OrderOriginsClient.parse("not json"))
        val noRequest = JSONObject(row.toString()).apply { remove("requestId") }
        val doc2 = JSONObject(doc.toString()).put("entries", JSONArray().put(noRequest))
        assertTrue(V2OrderOriginsClient.parse(doc2.toString())!!.isEmpty())
    }
}
