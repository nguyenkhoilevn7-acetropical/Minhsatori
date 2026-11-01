package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class OwnerPushPolicyTest {
    private val eventId = "0e7cc34a-5a0b-436f-97f8-081df4e5cdc0"

    @Test fun committedInvoiceRequiresPositiveNumber() {
        assertTrue(OwnerPushPolicy.valid("official_invoice_created", eventId, 5936L))
        assertFalse(OwnerPushPolicy.valid("official_invoice_created", eventId, null))
        assertFalse(OwnerPushPolicy.valid("official_invoice_created", eventId, 0L))
    }
    @Test fun registrationCannotCarryInvoiceNumber() {
        assertTrue(OwnerPushPolicy.valid("owner_registration_pending", eventId, null))
        assertFalse(OwnerPushPolicy.valid("owner_registration_pending", eventId, 5936L))
    }
    @Test fun rejectUnknownOrMalformedEvents() {
        assertFalse(OwnerPushPolicy.valid("payment_changed", eventId, null))
        assertFalse(OwnerPushPolicy.valid("official_invoice_created", "not-a-uuid", 5936L))
        assertFalse(OwnerPushPolicy.valid("official_invoice_created",
            "------------------------------------", 5936L))
    }
}
