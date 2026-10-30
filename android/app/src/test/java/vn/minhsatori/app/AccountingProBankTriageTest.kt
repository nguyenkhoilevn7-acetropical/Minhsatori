package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class AccountingProBankTriageTest {
    private fun tx(
        id: String = "bank-tx-a", account: String = "bank-account-a",
        invoice: Long? = 5901L, amount: Long = 400_000L,
        verified: Boolean = true,
        direction: AccountingProBankDirection = AccountingProBankDirection.CREDIT
    )=AccountingProBankTransfer(id,account,invoice,amount,direction,verified)

    private fun bill(
        id: String = "ledger-1", no: Long = 5901L,
        due: Long = 400_000L, revision: Long = 101L
    )=AccountingProBankInvoice(id,no,due,revision)

    private fun one(
        transfer: AccountingProBankTransfer=tx(),
        invoice: List<AccountingProBankInvoice> = listOf(bill())
    ): AccountingProBankTriageResult =
        AccountingProBankTriage.preview(101L,listOf(transfer),invoice).single()

    @Test fun exactAmountAndExplicitInvoiceIsOnlyReviewSuggestion() {
        val r=one()
        assertEquals(AccountingProBankTriageStatus.REVIEW_EXACT_CREDIT,r.status)
        assertTrue(r.isSuggestionOnly)
        assertEquals("ledger-1",r.matchedLedgerId)
    }

    @Test fun partialCreditNeverClaimsTheInvoiceIsPaid() {
        val r=one(tx(amount=250_000L))
        assertEquals(AccountingProBankTriageStatus.REVIEW_PARTIAL_CREDIT,r.status)
        assertTrue(r.isSuggestionOnly)
    }

    @Test fun amountWithoutInvoiceReferenceCannotMatch() {
        val r=one(tx(invoice=null))
        assertEquals(AccountingProBankTriageStatus.HOLD_MISSING_INVOICE_REFERENCE,r.status)
        assertNull(r.matchedLedgerId)
    }

    @Test fun unverifiedProviderEventIsNeverTrusted() {
        assertEquals(AccountingProBankTriageStatus.HOLD_UNVERIFIED,
            one(tx(verified=false)).status)
    }

    @Test fun duplicateBankEventIsHeldEvenIfAmountMatches() {
        val t=tx()
        val rows=AccountingProBankTriage.preview(101L,listOf(t,t),listOf(bill()))
        assertEquals(2,rows.size)
        assertTrue(rows.all { it.status ==
            AccountingProBankTriageStatus.HOLD_DUPLICATE_TRANSACTION })
    }

    @Test fun duplicatedCanonicalInvoiceNumberRequiresReview() {
        val r=one(tx(),listOf(bill(),bill(id="ledger-2")))
        assertEquals(AccountingProBankTriageStatus.HOLD_AMBIGUOUS_INVOICE,r.status)
    }

    @Test fun duplicateLedgerIdAcrossDifferentNumbersIsAmbiguous() {
        val r=one(tx(),listOf(bill(),bill(no=5902L)))
        assertEquals(AccountingProBankTriageStatus.HOLD_AMBIGUOUS_INVOICE,r.status)
    }

    @Test fun staleInvoiceRevisionNeverYieldsMatch() {
        assertEquals(AccountingProBankTriageStatus.HOLD_STALE_LEDGER,
            one(tx(),listOf(bill(revision=100))).status)
    }

    @Test fun overpaymentStaysUnmatchedUntilAllocationApproved() {
        val r=one(tx(amount=500_000L))
        assertEquals(AccountingProBankTriageStatus.HOLD_OVERPAYMENT,r.status)
        assertFalse(r.isSuggestionOnly)
    }

    @Test fun debitIsNotCustomerPayment() {
        val r=one(tx(direction=AccountingProBankDirection.DEBIT))
        assertEquals(AccountingProBankTriageStatus.HOLD_INVALID_TRANSACTION,r.status)
    }

    @Test fun missingBankIdAndInvalidAmountAreHeld() {
        assertEquals(AccountingProBankTriageStatus.HOLD_INVALID_TRANSACTION,
            one(tx(id="")).status)
        assertEquals(AccountingProBankTriageStatus.HOLD_INVALID_TRANSACTION,
            one(tx(amount=0L)).status)
    }

    @Test fun noVerifiedOpenBalanceIsNotMatched() {
        val r=one(tx(),emptyList())
        assertEquals(AccountingProBankTriageStatus.HOLD_AMBIGUOUS_INVOICE,r.status)
    }

    @Test fun cannotClaimFullyPaidInvoiceOpenBalanceZero() {
        assertEquals(AccountingProBankTriageStatus.HOLD_INVALID_OPEN_BALANCE,
            one(tx(),listOf(bill(due=0L))).status)
    }

    @Test fun differentAccountsCanHaveSameTransactionId() {
        val rows=AccountingProBankTriage.preview(101L,
            listOf(tx(account="account-a"),tx(account="account-b",amount=250_000L)),
            listOf(bill()))
        assertEquals(2,rows.size)
        assertTrue(rows.all { it.isSuggestionOnly })
    }

    @Test fun triageNeverMutatesInputLists() {
        val transfers=listOf(tx())
        val invoices=listOf(bill())
        val before=transfers.toList() to invoices.toList()
        AccountingProBankTriage.preview(101L,transfers,invoices)
        assertEquals(before.first,transfers)
        assertEquals(before.second,invoices)
    }
}
