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

    @Test fun originalInvoiceObjectsAreNeverMutated() {
        val original=listOf(invoice(),invoice(id="b",no="5902"))
        val before=original.toList()
        AccountingProMargin45.calculate(original)
        assertEquals(before,original)
    }
}
