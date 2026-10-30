package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountingProReadOnlyTest {
    private fun bill(
        id: String = "canonical-1",
        no: String = "5901",
        status: String = "Chưa thanh toán",
        total: Long = 1_000_000L,
        customerPaidAt: String = "",
        satoriPaidAt: String = "",
        pairRole: String = "",
        isTest: Boolean = false,
        date: String = "2026-10-30"
    ) = SatoriInvoice(
        id = id, number = no, date = date, customer = "Khách DEMO", phone = "",
        address = "", status = status, total = total, shipping = 0L, vat = 0L,
        lines = emptyList(), deliveryNote = "", customerPaidAt = customerPaidAt,
        duplicateFrom = "", pairRole = pairRole, satoriPaidAt = satoriPaidAt,
        isTest = isTest
    )

    @Test fun satoriSettlementNeverImpliesCustomerPaid() {
        val s = AccountingProReadOnly.summarize(listOf(
            bill(status = "Đã TT Satori", satoriPaidAt = "2026-10-29")
        ))
        assertEquals(1, s.satoriPaidFlagCount)
        assertEquals(1, s.customerUnpaidFlagCount)
        assertEquals(1_000_000L, s.unpaidByLegacyFlags)
    }

    @Test fun customerPaidFlagAndSatoriFlagAreIndependent() {
        val s = AccountingProReadOnly.summarize(listOf(
            bill(status = "Đã TT Satori", customerPaidAt = "2026-10-29")
        ))
        assertEquals(1, s.customerPaidFlagCount)
        assertEquals(1, s.satoriPaidFlagCount)
        assertEquals(0L, s.unpaidByLegacyFlags)
    }

    @Test fun excludedAndInternalCtvBillsNeverCountAsSales() {
        val s = AccountingProReadOnly.summarize(listOf(
            bill(), bill(id="internal",no="5902",pairRole="collaborator"),
            bill(id="cancel",no="5903",status="Đã hủy"),
            bill(id="test",no="5904",isTest=true)
        ))
        assertEquals(1, s.activeInvoiceCount)
        assertEquals(3, s.excludedInvoiceCount)
        assertEquals(1_000_000L, s.grossByLegacyFlags)
    }

    @Test fun ambiguousInvoiceIdentitySuppressesMonetaryClaims() {
        val s = AccountingProReadOnly.summarize(listOf(
            bill(), bill(id="different",no="5901",total=200_000L)
        ))
        assertEquals(2, s.questionableInvoiceCount)
        assertNull(s.grossByLegacyFlags)
        assertNull(s.unpaidByLegacyFlags)
    }

    @Test fun missingAndPlaceholderIdentitySuppressesTotals() {
        val missing = AccountingProReadOnly.summarize(listOf(bill(id="row-0",no="?")))
        assertEquals(1, missing.questionableInvoiceCount)
        assertNull(missing.unpaidByLegacyFlags)
    }

    @Test fun overflowDoesNotBecomeNegativeProfitOrDebt() {
        val s = AccountingProReadOnly.summarize(listOf(
            bill(total=Long.MAX_VALUE),
            bill(id="canonical-2",no="5902",total=1L)
        ))
        assertNull(s.grossByLegacyFlags)
        assertNull(s.unpaidByLegacyFlags)
    }

    @Test fun readOnlyProjectionDoesNotAlterInvoices() {
        val source = listOf(bill(),bill(id="canonical-2",no="5902",status="Đã thanh toán"))
        val copy = source.toList()
        val s = AccountingProReadOnly.summarize(source)
        assertEquals(copy,source)
        assertEquals(2,s.activeInvoiceCount)
        assertEquals(1,s.customerPaidFlagCount)
        assertEquals(1_000_000L,s.unpaidByLegacyFlags)
        assertTrue(s.questionableInvoiceCount == 0)
    }
}
