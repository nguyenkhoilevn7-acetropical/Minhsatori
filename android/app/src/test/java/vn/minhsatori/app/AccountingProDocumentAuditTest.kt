package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class AccountingProDocumentAuditTest {
    private fun bill(
        id: String = "doc-ledger-a", no: String = "5901",
        vat: Long = 0L, tax: String = "",
        status: String = "Chưa thanh toán",
        isTest: Boolean = false, role: String = ""
    ) = SatoriInvoice(
        id=id,number=no,date="2026-10-30",customer="Khách demo",
        phone="0900000000",address="HCM",status=status,total=800_000L,
        shipping=0L,vat=vat,lines=emptyList(),deliveryNote="",
        customerPaidAt="",duplicateFrom="",taxCode=tax,isTest=isTest,
        pairRole=role
    )

    @Test fun vatAmountIsNotTaxAuthorityIssuanceProof() {
        val r=AccountingProDocumentAudit.rows(listOf(bill(vat=80_000L))).single()
        assertTrue(r.hasVatAmountField)
        assertEquals(AccountingProDocumentProof.NOT_AVAILABLE_IN_SNAPSHOT,
            r.legalEInvoiceProof)
        assertEquals(AccountingProDocumentProof.NOT_AVAILABLE_IN_SNAPSHOT,
            r.archivedPdfProof)
    }

    @Test fun taxCodeIsNotLegalEInvoiceEvidence() {
        val row=AccountingProDocumentAudit.rows(listOf(bill(tax="0319548305"))).single()
        assertTrue(row.hasTaxCodeField)
        assertEquals(AccountingProDocumentProof.NOT_AVAILABLE_IN_SNAPSHOT,
            row.legalEInvoiceProof)
    }

    @Test fun absenceOfEmailOrDriveReferenceMustNotBeInterpretedAsNotSent() {
        val row=AccountingProDocumentAudit.rows(listOf(bill())).single()
        assertEquals(AccountingProDocumentProof.NOT_AVAILABLE_IN_SNAPSHOT,
            row.emailDeliveryProof)
        assertEquals(AccountingProDocumentProof.NOT_AVAILABLE_IN_SNAPSHOT,
            row.archivedPdfProof)
    }

    @Test fun allVerifiedCountersAreUnknownNotZero() {
        val summary=AccountingProDocumentAudit.summary(listOf(bill()))
        assertNull(summary.verifiedArchivedPdfCount)
        assertNull(summary.verifiedEmailDeliveredCount)
        assertNull(summary.verifiedLegalEInvoiceCount)
    }

    @Test fun excludeInternalCancelledTestInvoices() {
        val rows=AccountingProDocumentAudit.rows(listOf(
            bill(),bill(id="ctv",no="5902",role="collaborator"),
            bill(id="void",no="5903",status="Đã hủy"),
            bill(id="test",no="5904",isTest=true)
        ))
        assertEquals(1,rows.size)
        assertEquals(1,AccountingProDocumentAudit.summary(listOf(
            bill(),bill(id="ctv",no="5902",role="collaborator")
        )).excludedInvoices)
    }

    @Test fun duplicateInvoiceIdentityIsNotIgnored() {
        val sum=AccountingProDocumentAudit.summary(listOf(
            bill(),bill(id="other",no="5901")))
        assertEquals(2,sum.unreliableInvoiceIds)
    }

    @Test fun vatAndTaxFieldCountsNeverEqualNumberOfIssuedInvoices() {
        val s=AccountingProDocumentAudit.summary(listOf(
            bill(vat=80_000L,tax="0319548305"),
            bill(id="other",no="5902",vat=0L)
        ))
        assertEquals(1,s.rowsWithVatAmount)
        assertEquals(1,s.rowsWithTaxCode)
        assertNull(s.verifiedLegalEInvoiceCount)
    }

    @Test fun dataInspectionDoesNotChangeCanonicalInvoices() {
        val snapshot=listOf(bill(),bill(id="two",no="5902",vat=80_000L))
        val original=snapshot.toList()
        AccountingProDocumentAudit.summary(snapshot)
        assertEquals(original,snapshot)
    }
}
