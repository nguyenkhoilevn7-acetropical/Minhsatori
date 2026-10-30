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

    @Test fun detailRowsRetainEveryDistinctCanonicalInvoice() {
        val rows = AccountingProReadOnly.invoiceRows(listOf(
            bill(id="id-a",no="5901").copy(customer="Cùng khách",address="Điểm A"),
            bill(id="id-b",no="5902").copy(customer="Cùng khách",address="Điểm B")
        ))
        assertEquals(2, rows.size)
        assertTrue(rows.all { it.identityReliable })
        assertEquals(setOf("id-a","id-b"),rows.map { it.invoice.id }.toSet())
    }

    @Test fun customerSatoriFlagsRemainIndependentInEachDetailRow() {
        val rows = AccountingProReadOnly.invoiceRows(listOf(
            bill(id="id-a",no="5901",status="Đã TT Satori"),
            bill(id="id-b",no="5902",status="Đã thanh toán")
        ))
        assertTrue(rows.first { it.invoice.id=="id-a" }.pendingCustomerFlag)
        assertTrue(!rows.first { it.invoice.id=="id-a" }.pendingSatoriFlag)
        assertTrue(!rows.first { it.invoice.id=="id-b" }.pendingCustomerFlag)
        assertTrue(rows.first { it.invoice.id=="id-b" }.pendingSatoriFlag)
    }

    @Test fun sameNumberIsFlaggedEvenWhenBothNamesAndAmountsDiffer() {
        val rows = AccountingProReadOnly.invoiceRows(listOf(
            bill(id="id-a",no="5991"),
            bill(id="id-b",no="5991",total=1200L).copy(customer="Khác khách")
        ))
        assertEquals(2,rows.count { it.needsIdentityReview })
        assertTrue(rows.all { it.reason.contains("Số hóa đơn trùng") })
    }

    @Test fun duplicateIdsAreFlaggedEvenWhenNumbersAreDistinct() {
        val rows = AccountingProReadOnly.invoiceRows(listOf(
            bill(id="same",no="5901"), bill(id="same",no="5902")
        ))
        assertEquals(2,rows.count { it.needsIdentityReview })
        assertTrue(rows.all { it.reason.contains("ID hóa đơn") })
    }

    @Test fun invalidDatesAreDisplayedAsReviewNotFakeDebtAging() {
        val row=AccountingProReadOnly.invoiceRows(listOf(bill(date="unknown"))).single()
        assertTrue(row.needsDateReview)
        assertTrue(row.identityReliable)
    }

    @Test fun excludedInvoicesCannotAppearInDebtDrilldown() {
        val rows=AccountingProReadOnly.invoiceRows(listOf(
            bill(id="real",no="5901"),
            bill(id="fake",no="5902",isTest=true),
            bill(id="ctv",no="5903",pairRole="collaborator"),
            bill(id="void",no="5904",status="Đã hủy")
        ))
        assertEquals(listOf("real"),rows.map { it.invoice.id })
    }

    @Test fun pendingFlagDoesNotPretendToKnowPartialPayments() {
        val row=AccountingProReadOnly.invoiceRows(listOf(
            bill(total=1_000_000L, status="Chưa thanh toán")
        )).single()
        assertTrue(row.pendingCustomerFlag)
        assertEquals(1_000_000L,row.invoice.total)
        // No paidAmount, remainingAfterAllocation or bankValidated amount
        // is calculated by the read-only projection.
    }

}
