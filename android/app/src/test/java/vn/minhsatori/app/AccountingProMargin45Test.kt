package vn.minhsatori.app

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class AccountingProMargin45Test {
    private fun invoice(
        id:String="id-a",no:String="5901",date:String="2026-10-30",
        unitPrice:Long=80_000L,listPrice:Long=100_000L,
        qty:Int=10,total:Long=qty.toLong()*unitPrice,
        shipping:Long=0L,vat:Long=0L,
        pairRole:String="",pairGroup:String="",pairNo:String="",
        collaborator:String="",discount:Double?=null,
        status:String="Chưa thanh toán",isTest:Boolean=false
    ) = SatoriInvoice(
        id=id,number=no,date=date,customer="DEMO",
        phone="0900000000",address="267F Thủ Đức",
        status=status,total=total,shipping=shipping,vat=vat,
        lines=listOf(SatoriLine("Suối",qty,"thùng",unitPrice,listPrice,code="SUOI")),
        deliveryNote="",customerPaidAt="",duplicateFrom="",
        pairRole=pairRole,pairGroupId=pairGroup,pairInvoiceNo=pairNo,
        collaboratorId=collaborator,pairDiscountPercent=discount,isTest=isTest
    )

    @Test fun supplier45PercentMeans55PercentCostAnd25PercentGross() {
        val row=AccountingProMargin45.calculate(listOf(invoice())).single()
        assertEquals(800_000L,row.saleGoodsVnd)
        assertEquals(550_000L,row.estimatedPurchaseVnd)
        assertEquals(0L,row.estimatedCtvCommissionVnd)
        assertEquals(250_000L,row.estimatedOwnerMarginVnd)
    }

    @Test fun vatAndShippingNeverBecomeGoodsRevenueOrMargin() {
        val inv=invoice(total=880_000L,shipping=10_000L,vat=70_000L)
        val row=AccountingProMargin45.calculate(listOf(inv)).single()
        assertEquals(800_000L,row.saleGoodsVnd)
        assertEquals(250_000L,row.estimatedOwnerMarginVnd)
    }

    @Test fun verifiedCtvPairCommissionIsNotOwnersMargin() {
        val buyer=invoice(pairRole="customer",pairGroup="p1",pairNo="5902",collaborator="ctv1")
        val internal=invoice(id="ref",no="5902",unitPrice=65_000L,total=650_000L,
            pairRole="collaborator",pairGroup="p1",pairNo="5901",collaborator="ctv1")
        val rows=AccountingProMargin45.calculate(listOf(buyer,internal))
        assertEquals(1,rows.size)
        assertEquals(150_000L,rows.single().estimatedCtvCommissionVnd)
        assertEquals(100_000L,rows.single().estimatedOwnerMarginVnd)
    }

    @Test fun singleBillCtvDiscount35PercentCanProduceEstimate() {
        val row=AccountingProMargin45.calculate(listOf(
            invoice(collaborator="ctv1",discount=35.0))).single()
        assertEquals(150_000L,row.estimatedCtvCommissionVnd)
        assertEquals(100_000L,row.estimatedOwnerMarginVnd)
    }

    @Test fun canceledCtvReferenceCannotProduceEstimatedCommission() {
        val buyer=invoice(pairRole="customer",pairGroup="p1",pairNo="5902",collaborator="ctv1")
        val canceled=invoice(id="ref",no="5902",unitPrice=65_000L,total=650_000L,
            pairRole="collaborator",pairGroup="p1",pairNo="5901",collaborator="ctv1",
            status="Đã hủy")
        val result=AccountingProMargin45.calculate(listOf(buyer,canceled)).single()
        assertNull(result.estimatedOwnerMarginVnd)
        assertNotNull(result.reason)
    }

    @Test fun ambiguousLegacyPairWithoutRoleCannotUseDiscountSnapshot() {
        val row=AccountingProMargin45.calculate(listOf(
            invoice(pairGroup="unverified-pair",collaborator="ctv1",discount=35.0)
        )).single()
        assertNull(row.estimatedOwnerMarginVnd)
    }

    @Test fun ctvWithNoKnownPolicyRefusesToInventOwnerProfit() {
        val row=AccountingProMargin45.calculate(listOf(
            invoice(collaborator="ctv1"))).single()
        assertNull(row.estimatedOwnerMarginVnd)
        assertNotNull(row.reason)
    }

    @Test fun unknownPriceNeverMeansZeroPurchaseCost() {
        val row=AccountingProMargin45.calculate(listOf(
            invoice(listPrice=0L))).single()
        assertNull(row.estimatedOwnerMarginVnd)
        assertNull(row.estimatedPurchaseVnd)
    }

    @Test fun invoiceItemMismatchRefusesExactLookingMargin() {
        val row=AccountingProMargin45.calculate(listOf(
            invoice(total=1_000_000L))).single()
        assertNull(row.estimatedOwnerMarginVnd)
    }

    @Test fun doNotCountTestCancelledInternalOrTwoSales() {
        val rows=AccountingProMargin45.calculate(listOf(
            invoice(),invoice(id="test",no="5902",isTest=true),
            invoice(id="void",no="5903",status="Đã hủy"),
            invoice(id="internal",no="5904",pairRole="collaborator")
        ))
        assertEquals(1,rows.size)
        assertEquals(250_000L,rows.single().estimatedOwnerMarginVnd)
    }

    @Test fun duplicateNumbersCannotBeSummedAsOwnerProfit() {
        val rows=AccountingProMargin45.calculate(listOf(
            invoice(),invoice(id="different",no="5901")
        ))
        assertEquals(2,rows.size)
        assertTrue(rows.all{it.estimatedOwnerMarginVnd==null})
    }

    @Test fun acrossDatesDayMonthYearAndCustomAllReturnCorrectTotals() {
        val rows=AccountingProMargin45.calculate(listOf(
            invoice(date="2026-10-30"),
            invoice(id="b",no="5902",date="2026-10-29"),
            invoice(id="c",no="5903",date="2026-09-30"),
            invoice(id="d",no="5904",date="2025-10-30")
        ))
        fun total(p:AccountingProMargin45Period)=
            AccountingProMargin45.summarize(rows,p).estimatedMarginKnownVnd
        assertEquals(250_000L,total(AccountingProMargin45Period.day(LocalDate.of(2026,10,30))))
        assertEquals(500_000L,total(AccountingProMargin45Period.month(2026,10)))
        assertEquals(750_000L,total(AccountingProMargin45Period.year(2026)))
        assertEquals(500_000L,total(AccountingProMargin45Period.custom(
            LocalDate.of(2026,9,30),LocalDate.of(2026,10,29))))
        assertEquals(1_000_000L,total(AccountingProMargin45Period.all()))
    }

    @Test fun unavailableInvoicesReportCoverageRatherThanInflatingTotal() {
        val rows=AccountingProMargin45.calculate(listOf(invoice(),
            invoice(id="b",no="5902",listPrice=0L)))
        val summary=AccountingProMargin45.summarize(rows,AccountingProMargin45Period.all())
        assertEquals(2,summary.totalInvoiceCount)
        assertEquals(1,summary.computedInvoiceCount)
        assertEquals(1,summary.missingInvoiceCount)
        assertEquals(250_000L,summary.estimatedMarginKnownVnd)
        assertFalse(summary.fullyCovered)
    }

    @Test fun malformedDateIsExcludedFromAllPeriodSummariesAndMarked() {
        val rows=AccountingProMargin45.calculate(listOf(
            invoice(date="31/02/2026")
        ))
        val s=AccountingProMargin45.summarize(rows,AccountingProMargin45Period.all())
        assertEquals(0,s.totalInvoiceCount)
        assertEquals(1,s.excludedInvalidDates)
        assertNull(s.estimatedMarginKnownVnd)
    }

    @Test fun invalidCustomRangeRejects() {
        try {
            AccountingProMargin45Period.custom(LocalDate.of(2026,11,1),
                LocalDate.of(2026,10,1))
            fail("Invalid range should fail")
        } catch (_: IllegalArgumentException) { }
    }

    @Test fun amountOverflowFailsClosed() {
        val row=AccountingProMargin45.calculate(listOf(
            invoice(qty=Int.MAX_VALUE,unitPrice=Long.MAX_VALUE,listPrice=Long.MAX_VALUE,
                total=Long.MAX_VALUE)
        )).single()
        assertNull(row.estimatedOwnerMarginVnd)
    }

    @Test fun registeredCtvNetMarginExcludesCommissionAndVat() {
        // Synthetic #5966-shaped order: 10 cases at 266,666 VND, 8% VAT,
        // factory 45% discount and registered collaborator 35% discount.
        val bill = invoice(no="5966", unitPrice=266_666L, listPrice=333_333L,
            qty=10, total=2_879_993L, vat=213_333L)
        // Real legacy orders use the receiver phone, NOT the registered CTV phone.
        val ctv = SatoriCollaborator("ctv-verified", "DEMO", "0988888888", 35.0)
        val result = AccountingProMargin45.calculate(listOf(bill), listOf(ctv)).single()
        assertEquals(833_328L, result.saleGoodsVnd!! - result.estimatedPurchaseVnd!!)
        assertEquals(499_995L, result.estimatedCtvCommissionVnd)
        assertEquals(333_333L, result.estimatedOwnerMarginVnd)
        assertEquals(0L, bill.shipping)
        assertEquals(213_333L, bill.vat)
    }

    @Test fun recipientPhoneDoesNotDetermineCtvOwnershipButNameMustBeUnique() {
        val bill = invoice()
        val registered = SatoriCollaborator("ctv1", "DEMO", "0988888888", 35.0)
        // 80% customer sale, 65% registered CTV base, 55% supplier basis.
        // Different recipient phone MUST NOT suppress 15% CTV commission.
        val correct = AccountingProMargin45.calculate(listOf(bill),
            listOf(registered)).single()
        assertEquals(150_000L, correct.estimatedCtvCommissionVnd)
        assertEquals(100_000L, correct.estimatedOwnerMarginVnd)
        // A regular customer with a different name must not inherit CTV rates.
        val unrelated = registered.copy(name="OTHER")
        assertEquals(250_000L, AccountingProMargin45.calculate(listOf(bill),
            listOf(unrelated)).single().estimatedOwnerMarginVnd)
        // Same-name duplicates are ambiguous even with different registered phones.
        val duplicate = registered.copy(id="ctv2",phone="0900000000")
        val unresolved = AccountingProMargin45.calculate(listOf(bill),
            listOf(registered,duplicate)).single()
        assertNull(unresolved.estimatedOwnerMarginVnd)
        assertNotNull(unresolved.reason)
        // An explicit, verified CTV ID continues to support third-party buyers.
        val assigned = bill.copy(customer="CUSTOMER",collaboratorId=registered.id)
        assertEquals(100_000L, AccountingProMargin45.calculate(listOf(assigned),
            listOf(registered)).single().estimatedOwnerMarginVnd)
        assertEquals(250_000L, AccountingProMargin45.calculate(listOf(bill))
            .single().estimatedOwnerMarginVnd) // Gross only if registry unavailable
    }

    @Test fun alreadyAtCtvUnitPriceRoundingDoesNotMakePhantomNegativeCommission() {
        // Legacy #5917-shaped data: six units priced individually at 35% off.
        // The aggregate 65% base rounds a few dong above the summed unit prices.
        val invoice = invoice(no="5917",qty=6,unitPrice=216_666L,
            listPrice=333_333L,total=1_403_996L,shipping=104_000L)
        val priced = invoice.copy(lines=invoice.lines.map {
            it.copy(discountPercent=35.0)
        })
        val registered=SatoriCollaborator("ctv1","DEMO","0988888888",35.0)
        val result=AccountingProMargin45.calculate(listOf(priced),listOf(registered)).single()
        assertEquals(0L,result.estimatedCtvCommissionVnd)
        assertEquals(199_997L,result.estimatedOwnerMarginVnd)
        // A lower, unverified price must continue to fail closed.
        val priceConflict=priced.copy(lines=priced.lines.map {
            it.copy(unitPrice=210_000L)
        },total=1_364_000L)
        val blocked=AccountingProMargin45.calculate(listOf(priceConflict),listOf(registered)).single()
        assertNull(blocked.estimatedOwnerMarginVnd)
        assertNotNull(blocked.reason)
    }

    @Test fun originalInvoiceObjectsAreNeverMutated() {
        val original=listOf(invoice(),invoice(id="b",no="5902"))
        val before=original.toList()
        AccountingProMargin45.calculate(original)
        assertEquals(before,original)
    }
}
