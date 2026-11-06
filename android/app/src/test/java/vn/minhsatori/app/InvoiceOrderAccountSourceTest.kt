package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class InvoiceOrderAccountSourceTest {
    private fun bill(
        recipient: String = "Ngọc Ngô",
        collaborator: String = "",
        sourceId: String = "",
        sourceName: String = "",
        sourceRole: String = ""
    ) = SatoriInvoice(
        id = "real-id-5978", number = "5978", date = "06/11/2026",
        customer = recipient, phone = "000000000", address = "Điểm giao hàng",
        status = "Chưa thanh toán", total = 212296, shipping = 0, vat = 15726,
        lines = listOf(SatoriLine("Suối", 5, "Bình", 39314, 49143)),
        deliveryNote = "", customerPaidAt = "", duplicateFrom = "",
        collaboratorId = collaborator,
        orderedByAccountId = sourceId, orderedByName = sourceName,
        orderedByRole = sourceRole
    )
    private fun ledger(invoice: SatoriInvoice = bill(),
                       collaborators: List<SatoriCollaborator> = emptyList(),
                       loaded: Boolean = true) =
        SatoriSnapshot(228L, "", listOf(invoice),
            collaborators = collaborators, collaboratorRegistryLoaded = loaded)

    @Test fun explicitAuthenticatedAccountIsShownSeparatelyFromRecipient() {
        val invoice = bill(sourceId = "v2-account-verified",
            sourceName = "Hà Minh Nguyệt", sourceRole = "collaborator")
        val display = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice))
        assertEquals("Đặt từ: Hà Minh Nguyệt · CTV", display.card)
        assertEquals("Hà Minh Nguyệt", display.detail)
        assertEquals("CTV", display.accountRole)
        assertTrue(display.verifiedLogin)
        assertFalse(display.card.contains("Ngọc Ngô"))
    }

    @Test fun roleLabelsRemainDistinct() {
        val roles = mapOf("agency" to "Đại Lý", "retail" to "Khách Lẻ",
            "owner" to "Quản trị")
        roles.forEach { (role, expected) ->
            val invoice = bill(sourceId = "verified-account",
                sourceName = "Tài khoản ví dụ", sourceRole = role)
            val result = InvoiceOrderAccountSource.resolve(invoice, ledger(invoice))
            assertEquals("Đặt từ: Tài khoản ví dụ · $expected", result.card)
        }
    }

    @Test fun receiverNameOrPhoneNeverDeterminesAccount() {
        val invoice = bill(recipient = "Hà Minh Nguyệt")
        val partners = listOf(SatoriCollaborator(
            "ctv1", "Hà Minh Nguyệt", "000000000", 35.0))
        val display = InvoiceOrderAccountSource.resolve(invoice,
            ledger(invoice, collaborators = partners))
        assertFalse(display.verifiedLogin)
        assertTrue(display.card.contains("Chưa xác định tài khoản đặt hàng"))
    }

    @Test fun explicitCollaboratorLinkDoesNotPretendToVerifyLoginAccount() {
        val invoice = bill(collaborator = "ctv1")
        val ctv = SatoriCollaborator("ctv1", "Hà Minh Nguyệt", "000", 35.0)
        val display = InvoiceOrderAccountSource.resolve(invoice,
            ledger(invoice, listOf(ctv)))
        assertEquals(InvoiceOrderAccountSource.UNKNOWN, display.card)
        assertFalse(display.verifiedLogin)
        assertEquals(InvoiceOrderAccountSource.UNKNOWN, display.detail)
    }

    @Test fun duplicateOrMissingCtvRegistryCannotProduceAttribution() {
        val invoice = bill(collaborator = "ctv1")
        val one = SatoriCollaborator("ctv1", "CTV A", "", 35.0)
        val two = one.copy(name = "CTV B")
        val unknown = listOf(
            ledger(invoice, listOf(one, two)),
            ledger(invoice, listOf(one), loaded = false),
            ledger(invoice))
        unknown.forEach {
            val display = InvoiceOrderAccountSource.resolve(invoice, it)
            assertTrue(display.card.contains("Chưa xác định tài khoản đặt hàng"))
            assertFalse(display.verifiedLogin)
        }
    }

    @Test fun incompleteOrUnknownLoginMetadataIsNotTrusted() {
        listOf(
            bill(sourceName = "Hà Minh Nguyệt", sourceRole = "collaborator"),
            bill(sourceId = "verified-account", sourceName = "Hà Minh Nguyệt"),
            bill(sourceId = "verified-account", sourceRole = "collaborator"),
            bill(sourceId = "verified-account", sourceName = "Hà Minh Nguyệt",
                sourceRole = "unexpected")
        ).forEach {
            assertFalse(InvoiceOrderAccountSource.resolve(it, ledger(it)).verifiedLogin)
        }
    }

    @Test fun verifiedV2RegistryCanResolveOldBillWithoutChangingRecipient() {
        val invoice = bill()
        val origin = SatoriOrderOrigin(invoice.id, invoice.number,
            "auth-v2-account", "Hà Minh Nguyệt", "collaborator")
        val snapshot = ledger(invoice).copy(orderOrigins = listOf(origin))
        val display = InvoiceOrderAccountSource.resolve(invoice, snapshot)
        assertTrue(display.verifiedLogin)
        assertEquals("Đặt từ: Hà Minh Nguyệt · CTV", display.card)
        assertEquals("Ngọc Ngô", invoice.customer)
    }

    @Test fun oldBillAttributionNeverMatchesOnlyNumberOrName() {
        val invoice = bill()
        val wrong = SatoriOrderOrigin("different-ledger-id", invoice.number,
            "v2-wrong-account", "Hà Minh Nguyệt", "collaborator")
        val mismatchedNo = wrong.copy(ledgerInvoiceId = invoice.id,
            invoiceNo = "5999")
        val duplicate = SatoriOrderOrigin(invoice.id, invoice.number,
            "v2-a", "CTV A", "collaborator")
        val duplicate2 = duplicate.copy(accountId = "v2-b", accountName = "CTV B")
        for (origins in listOf(listOf(wrong), listOf(mismatchedNo),
            listOf(duplicate, duplicate2))) {
            val result = InvoiceOrderAccountSource.resolve(invoice,
                ledger(invoice).copy(orderOrigins = origins))
            assertFalse(result.verifiedLogin)
            assertTrue(result.card.contains("Chưa xác định tài khoản đặt hàng"))
        }
    }

    @Test fun optionalRegistryParserDoesNotInvalidateFinancialLedger() {
        fun raw(value: String) = JSONObject().put("revision", 231)
            .put("values", JSONObject()
                .put("satori_orders_v15", "[]")
                .put("satori_v2_order_origins_v1", value)).toString()
        val invoiceOrigin = JSONObject()
            .put("ledgerInvoiceId", "1793954613776")
            .put("invoiceNo", 5978)
            .put("accountId", "v2-account")
            .put("accountName", "Hà Minh Nguyệt")
            .put("accountRole", "collaborator")
        val parsed = SatoriData.fromDriveState(raw(
            JSONArray().put(invoiceOrigin).toString()))
        assertEquals(1, parsed.orderOrigins.size)
        assertEquals("5978", parsed.orderOrigins.single().invoiceNo)
        val malformed = SatoriData.fromDriveState(raw("not-json"))
        assertTrue(malformed.orderOrigins.isEmpty())
        assertTrue(malformed.invoices.isEmpty())
    }

    @Test fun parsedLedgerKeepsOrdererAndRecipientIndependent() {
        val order = JSONObject()
            .put("id", "immutable-id").put("invoiceNo", 5978)
            .put("date", "06/11/2026").put("name", "Ngọc Ngô")
            .put("orderedByAccountId", "v2-id-verified")
            .put("orderedByName", "Hà Minh Nguyệt")
            .put("orderedByRole", "collaborator")
            .put("total", 212296).put("vatAmount", 15726)
            .put("items", JSONArray().put(
                JSONObject().put("product", "Suối").put("qty", 5)
                    .put("unitPrice", 39314).put("listPrice", 49143)))
        val state = JSONObject().put("revision", 228)
            .put("values", JSONObject().put("satori_orders_v15",
                JSONArray().put(order).toString()))
        val invoice = SatoriData.fromDriveState(state.toString()).invoices.single()
        assertEquals("Ngọc Ngô", invoice.customer)
        assertEquals("Hà Minh Nguyệt", invoice.orderedByName)
        assertEquals("collaborator", invoice.orderedByRole)
        assertTrue(InvoiceOrderAccountSource.resolve(invoice, ledger(invoice)).verifiedLogin)
    }
    @Test fun conflictingAuthenticatedSourcesAreNotDisplayed() {
        val invoice = bill(sourceId = "one", sourceName = "Account A", sourceRole = "retail")
        val mapped = SatoriOrderOrigin(invoice.id, invoice.number, "two", "Account B", "agency")
        val result = InvoiceOrderAccountSource.resolve(invoice,
            ledger(invoice).copy(orderOrigins = listOf(mapped)))
        assertFalse(result.verifiedLogin)
        assertEquals(InvoiceOrderAccountSource.UNKNOWN, result.card)
    }

    @Test fun duplicateRegistryCannotBeBypassedByInlineMetadata() {
        val invoice = bill(sourceId = "one", sourceName = "Account A", sourceRole = "retail")
        val mapped = SatoriOrderOrigin(invoice.id, invoice.number, "one", "Account A", "retail")
        assertFalse(InvoiceOrderAccountSource.resolve(invoice,
            ledger(invoice).copy(orderOrigins = listOf(mapped, mapped))).verifiedLogin)
    }

    @Test fun oversizedIdentityIsRejectedRatherThanTruncatedIntoMatch() {
        val row = JSONObject().put("ledgerInvoiceId", "x".repeat(101)).put("invoiceNo", "5978")
            .put("accountId", "one").put("accountName", "Account A").put("accountRole", "retail")
        val state = JSONObject().put("revision", 231).put("values", JSONObject()
            .put("satori_orders_v15", "[]")
            .put("satori_v2_order_origins_v1", JSONArray().put(row).toString()))
        assertTrue(SatoriData.fromDriveState(state.toString()).orderOrigins.isEmpty())
    }
}
