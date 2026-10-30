package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class AccountingProProfitAuditTest {
    private fun bill(
        id: String = "invoice-a", no: String = "5901",
        total: Long = 800_000L, role: String = "",
        group: String = "", linkedNo: String = "",
        collaboratorId: String = "", collaboratorName: String = "",
        address: String = "Linh Đông", status: String = "Chưa thanh toán",
        lines: List<SatoriLine> = listOf(SatoriLine("Suối",10,"thùng",80_000,100_000)),
        isTest: Boolean = false
    ) = SatoriInvoice(
        id=id,number=no,date="2026-10-30",customer="Khách demo",
        phone="0900000000",address=address,status=status,total=total,
        shipping=0L,vat=0L,lines=lines,deliveryNote="",
        customerPaidAt="",duplicateFrom="",pairRole=role,pairGroupId=group,
        pairInvoiceNo=linkedNo,collaboratorId=collaboratorId,
        pairCollaboratorName=collaboratorName,isTest=isTest
    )

    @Test fun oneCustomerBillPlusInternalReferenceCountsOnlyOneSale() {
        val buyer=bill(role="customer",group="pair-a",linkedNo="5902",
            collaboratorId="ctv-a",collaboratorName="CTV Demo")
        val internal=bill(id="internal",no="5902",total=650_000L,
            role="collaborator",group="pair-a",linkedNo="5901",
            collaboratorId="ctv-a")
        val all=listOf(buyer,internal)
        val summary=AccountingProProfitAudit.summary(all)
        assertEquals(1,summary.activeSaleCount)
        assertEquals(1,summary.excludedInternalBillCount)
        assertEquals(800_000L,summary.grossInvoiceTotalVnd)
        assertEquals(1,summary.legacyCtvReferenceCount)
        assertEquals(0,summary.legacyPairsNeedingReviewCount)
        assertTrue(AccountingProProfitAudit.rows(all).single().legacyPairVerified)
    }

    @Test fun neverConvertHistoricalPairDifferenceIntoPayableCommission() {
        val buyer=bill(role="customer",group="pair-b",linkedNo="5902",collaboratorId="ctv-b")
        val internal=bill(id="internal",no="5902",total=650_000L,
            role="collaborator",group="pair-b",linkedNo="5901",collaboratorId="ctv-b")
        val summary=AccountingProProfitAudit.summary(listOf(buyer,internal))
        assertNull(summary.verifiedCommissionLiabilityVnd)
        assertNull(summary.verifiedNetProfitVnd)
        assertNull(summary.verifiedPurchaseCostVnd)
        assertNull(summary.verifiedDeliveryExpenseVnd)
    }

    @Test fun invalidPairMustBeFlaggedNotSilentlyTrusted() {
        val buyer=bill(role="customer",group="pair-a",linkedNo="5902",collaboratorId="ctv-a")
        val differentAddress=bill(id="internal",no="5902",total=650_000L,
            role="collaborator",group="pair-a",linkedNo="5901",
            collaboratorId="ctv-a",address="Different")
        val row=AccountingProProfitAudit.rows(listOf(buyer,differentAddress)).single()
        assertTrue(row.pairNeedsReview)
        assertFalse(row.legacyPairVerified)
    }

    @Test fun missingInternalPartnerIsReviewNotASecondSale() {
        val buyer=bill(role="customer",group="pair-x",linkedNo="5902",collaboratorId="ctv-a")
        val summary=AccountingProProfitAudit.summary(listOf(buyer))
        assertEquals(1,summary.activeSaleCount)
        assertEquals(1,summary.legacyPairsNeedingReviewCount)
    }

    @Test fun noCostDataMeansNoRealProfitEvenWhenListPricesExist() {
        val s=AccountingProProfitAudit.summary(listOf(bill(total=800_000L)))
        assertEquals(800_000L,s.grossInvoiceTotalVnd)
        assertNull(s.verifiedNetProfitVnd)
        assertNull(s.verifiedPurchaseCostVnd)
        assertNull(s.verifiedCommissionLiabilityVnd)
    }

    @Test fun missingCtvMetadataMustNotBeCalledNonCtv() {
        val row=AccountingProProfitAudit.rows(listOf(bill())).single()
        assertFalse(row.hasLegacyCtvMetadata)
        assertEquals("Chưa có dữ liệu CTV",row.historicalCtvLabel)
    }

    @Test fun duplicateInvoiceNumberSuppressesMonetaryTotals() {
        val s=AccountingProProfitAudit.summary(listOf(
            bill(),bill(id="other",no="5901",total=100_000L)
        ))
        assertEquals(2,s.invalidInvoiceIdentityCount)
        assertNull(s.grossInvoiceTotalVnd)
        assertNull(s.verifiedNetProfitVnd)
    }

    @Test fun excludedTestCancelAndInternalInvoicesNeverCountAsSales() {
        val s=AccountingProProfitAudit.summary(listOf(
            bill(),bill(id="internal",no="5902",role="collaborator"),
            bill(id="test",no="5903",isTest=true),
            bill(id="cancel",no="5904",status="Đã hủy")
        ))
        assertEquals(1,s.activeSaleCount)
        assertEquals(1,s.excludedInternalBillCount)
    }

    @Test fun incompleteProductRowsNeedReviewButNotFakeCosts() {
        val row=AccountingProProfitAudit.rows(listOf(bill(lines=emptyList()))).single()
        assertTrue(row.missingProductDetail)
        assertNull(AccountingProProfitAudit.summary(listOf(bill(lines=emptyList()))).verifiedNetProfitVnd)
    }

    @Test fun auditNeverMutatesCanonicalInvoiceSnapshot() {
        val source=listOf(bill(),bill(id="two",no="5902",total=500_000L))
        val copy=source.toList()
        AccountingProProfitAudit.summary(source)
        assertEquals(copy,source)
    }
}
