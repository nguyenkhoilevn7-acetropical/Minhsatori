package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AccountingProPaymentAllocationTest {
    private fun open(
        id: String = "ledger-a", no: Long = 5901L,
        revision: Long = 100L, due: Long = 1_000_000L
    ) = AccountingProVerifiedOpenBalance(id, no, revision, due)

    private fun allocation(
        id: String = "ledger-a", no: Long = 5901L, amount: Long = 400_000L
    ) = AccountingProAllocationLine(id, no, amount)

    private fun expectRejected(reason: String, operation: () -> Unit) {
        try {
            operation()
            fail("Expected rejection: $reason")
        } catch (e: IllegalArgumentException) {
            assertEquals(reason, e.message)
        }
    }

    @Test fun partialPaymentLeavesAnExplicitOpenBalance() {
        val result = AccountingProPaymentAllocation.preview(
            400_000L, 100L, listOf(open()), listOf(allocation())
        )
        assertEquals(400_000L, result.allocatedVnd)
        assertEquals(0L, result.unallocatedVnd)
        assertEquals(600_000L, result.remainingByLedgerId["ledger-a"])
        assertTrue(result.needsManualReview)
    }

    @Test fun oneReceiptCanPayMultipleDistinctInvoices() {
        val result = AccountingProPaymentAllocation.preview(
            650_000L, 100L,
            listOf(open(due=350_000L),open("ledger-b",5902L,100L,500_000L)),
            listOf(allocation(amount=350_000L),allocation("ledger-b",5902L,300_000L))
        )
        assertEquals(0L, result.unallocatedVnd)
        assertEquals(0L, result.remainingByLedgerId["ledger-a"])
        assertEquals(200_000L, result.remainingByLedgerId["ledger-b"])
    }

    @Test fun receiptExcessRemainsUnallocatedNeverChangesBillTotal() {
        val result = AccountingProPaymentAllocation.preview(
            500_000L, 100L, listOf(open()), listOf(allocation())
        )
        assertEquals(100_000L, result.unallocatedVnd)
        assertEquals(600_000L, result.remainingByLedgerId["ledger-a"])
    }

    @Test fun rejectAllocationLargerThanReceipt() {
        expectRejected("ALLOCATION_EXCEEDS_RECEIPT") {
            AccountingProPaymentAllocation.preview(
                100L,100L,listOf(open()),listOf(allocation(amount=101L)))
        }
    }

    @Test fun rejectAllocationLargerThanOutstanding() {
        expectRejected("ALLOCATION_EXCEEDS_OPEN_BALANCE") {
            AccountingProPaymentAllocation.preview(
                999L,100L,listOf(open(due=500L)),listOf(allocation(amount=501L)))
        }
    }

    @Test fun rejectStaleRevision() {
        expectRejected("STALE_LEDGER_REVISION") {
            AccountingProPaymentAllocation.preview(
                400_000L,101L,listOf(open()),listOf(allocation()))
        }
    }

    @Test fun rejectNumberMismatchEvenWithSameImmutableId() {
        expectRejected("INVOICE_NUMBER_MISMATCH") {
            AccountingProPaymentAllocation.preview(
                400_000L,100L,listOf(open()),listOf(allocation(no=5902L)))
        }
    }

    @Test fun rejectDuplicateLedgerIdAndDuplicateInvoiceNumber() {
        expectRejected("AMBIGUOUS_INVOICE") {
            AccountingProPaymentAllocation.preview(
                400_000L,100L,listOf(open(),open("ledger-a",5902L)),listOf(allocation()))
        }
        expectRejected("AMBIGUOUS_INVOICE") {
            AccountingProPaymentAllocation.preview(
                400_000L,100L,listOf(open(),open("ledger-b",5901L)),listOf(allocation()))
        }
    }

    @Test fun rejectAllocatingSameBillTwice() {
        expectRejected("DUPLICATE_ALLOCATION") {
            AccountingProPaymentAllocation.preview(
                800_000L,100L,listOf(open()),listOf(allocation(),allocation()))
        }
    }

    @Test fun rejectAmbiguousMissingOrSyntheticIds() {
        for(id in listOf("", "row-1", " ledger-a")) {
            expectRejected("CANONICAL_INVOICE_ID_REQUIRED") {
                AccountingProPaymentAllocation.preview(
                    400_000L,100L,listOf(open(id=id)),listOf(allocation(id=id)))
            }
        }
    }

    @Test fun rejectUnverifiedInvoiceAndZeroAmount() {
        expectRejected("INVOICE_NOT_IN_VERIFIED_BALANCES") {
            AccountingProPaymentAllocation.preview(
                400_000L,100L,listOf(open()),listOf(allocation(id="other")))
        }
        expectRejected("RECEIPT_AMOUNT_INVALID") {
            AccountingProPaymentAllocation.preview(
                0L,100L,listOf(open()),listOf(allocation()))
        }
    }

    @Test fun rejectOverflowWithoutWrappingMoney() {
        expectRejected("PAYMENT_OVERFLOW") {
            AccountingProPaymentAllocation.preview(
                Long.MAX_VALUE,100L,
                listOf(open(due=Long.MAX_VALUE),open("ledger-b",5902L,100L,1L)),
                listOf(allocation(amount=Long.MAX_VALUE),
                    allocation("ledger-b",5902L,1L))
            )
        }
    }
}
