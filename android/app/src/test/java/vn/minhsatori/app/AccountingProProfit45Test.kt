package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

class AccountingProProfit45Test {
    private fun line(qty:Int=10,price:Long=80000L,list:Long=100000L) =
        SatoriLine("Nước suối",qty,"thùng",price,list,code="WATER")
    private fun bill(
        id:String="bill-a",number:String="5901",date:String="30/10/2026",
        items:List<SatoriLine> = listOf(line()),total:Long=800000L,
        shipping:Long=0L,vat:Long=0L,status:String="Chưa thanh toán",
        role:String="",pair:String="",pairNo:String="",ctv:String="",isTest:Boolean=false
    )=SatoriInvoice(
        id=id,number=number,date=date,customer="Khách demo",phone="0900000000",
        address="Địa chỉ DEMO",status=status,total=total,shipping=shipping,vat=vat,
        lines=items,deliveryNote="",customerPaidAt="",duplicateFrom="",
        pairRole=role,pairGroupId=pair,pairInvoiceNo=pairNo,collaboratorId=ctv,
        isTest=isTest
    )

    private val yearStart=LocalDate.of(2026,1,1)
    private val yearEnd=LocalDate.of(2026,12,31)

    @Test fun fortyFivePercentCompanyDiscountCreatesTwentyFivePercentMarginForCustomer20Off() {
        val r=AccountingProProfit45.summarize(listOf(bill()),yearStart,yearEnd)
        assertEquals(800000L,r.saleMerchandiseRevenueVnd)
        assertEquals(550000L,r.purchaseCostEstimateVnd)
        assertEquals(250000L,r.grossMerchandiseMarginVnd)
        assertEquals(250000L,r.afterCtvMarginVnd)
        assertEquals(1,r.calculatedCount)
    }

    @Test fun customerGetsThirtyPercentDiscountMeansFifteenPercentMerchandiseMargin() {
        val r=AccountingProProfit45.summarize(listOf(
            bill(items=listOf(line(price=70000)),total=700000L)),yearStart,yearEnd)
        assertEquals(150000L,r.grossMerchandiseMarginVnd)
    }

    @Test fun vatAndShippingAreExcludedFromMerchandiseMargin() {
        val r=AccountingProProfit45.summarize(listOf(bill(
            total=908000L,shipping=28000L,vat=80000L)),yearStart,yearEnd)
        assertEquals(250000L,r.grossMerchandiseMarginVnd)
        assertEquals(800000L,r.saleMerchandiseRevenueVnd)
    }

    @Test fun validatedCtvPairYieldsTenPercentOwnerMarginAndOnlyOneSale() {
        val customer=bill(role="customer",pair="pair-1234",pairNo="5902",ctv="ctv-a")
        val internal=bill(id="internal",number="5902",
            items=listOf(line(price=65000)),total=650000L,
            role="collaborator",pair="pair-1234",pairNo="5901",ctv="ctv-a")
        val s=AccountingProProfit45.summarize(listOf(customer,internal),yearStart,yearEnd)
        assertEquals(1,s.invoiceCount)
        assertEquals(250000L,s.grossMerchandiseMarginVnd)
        assertEquals(150000L,s.records.single().verifiedLegacyCtvCommissionVnd)
        assertEquals(100000L,s.afterCtvMarginVnd)
    }

    @Test fun unverifiedCtvNeverMakesTotalAfterCtvProfitLookAccurate() {
        val customer=bill(role="customer",pair="pair-1234",pairNo="5902",ctv="ctv-a")
        val s=AccountingProProfit45.summarize(listOf(customer),yearStart,yearEnd)
        assertEquals(250000L,s.grossMerchandiseMarginVnd)
        assertNull(s.afterCtvMarginVnd)
        assertEquals(1,s.ctvUnverifiedCount)
    }

    @Test fun invalidAndRepeatedInvoiceIdsAreExcludedFromCalculatedTotal() {
        val rows=listOf(
            bill(id="a",number="5901"),
            bill(id="b",number="5901"),
            bill(id="c",number="5903")
        )
        val s=AccountingProProfit45.summarize(rows,yearStart,yearEnd)
        assertEquals(3,s.invoiceCount)
        assertEquals(1,s.calculatedCount)
        assertEquals(2,s.skippedCount)
        assertEquals(250000L,s.grossMerchandiseMarginVnd)
    }

    @Test fun missingListPriceCannotProduceFalseCostOrProfit() {
        val s=AccountingProProfit45.summarize(listOf(
            bill(items=listOf(line(list=0L)))),yearStart,yearEnd)
        assertEquals(1,s.skippedCount)
        assertNull(s.records.single().merchandiseMarginBeforeCtvVnd)
    }

    @Test fun mismatchBetweenGoodsAndFinalTotalIsRejected() {
        val s=AccountingProProfit45.summarize(listOf(bill(total=800240L)),yearStart,yearEnd)
        assertEquals(1,s.skippedCount)
        assertTrue(s.records.single().warning!!.contains("không khớp"))
    }

    @Test fun cancelledTestAndInternalBillsNeverCountAsSales() {
        val s=AccountingProProfit45.summarize(listOf(
            bill(),bill(id="test",number="5902",isTest=true),
            bill(id="void",number="5903",status="Đã hủy"),
            bill(id="ctv",number="5904",role="collaborator")
        ),yearStart,yearEnd)
        assertEquals(1,s.invoiceCount)
        assertEquals(250000L,s.grossMerchandiseMarginVnd)
    }

    @Test fun crossMonthAndCrossYearNeverLeakIntoPeriod() {
        val invoices=listOf(
            bill(),bill(id="second",number="5902",date="2026-11-01"),
            bill(id="third",number="5903",date="2025-10-30"))
        val october=AccountingProProfit45.month(YearMonth.of(2026,10))
        assertEquals(1,AccountingProProfit45.summarize(invoices,october.first,october.second).invoiceCount)
        val all2026=AccountingProProfit45.year(2026)
        assertEquals(2,AccountingProProfit45.summarize(invoices,all2026.first,all2026.second).invoiceCount)
        val day=AccountingProProfit45.day(LocalDate.of(2026,10,30))
        assertEquals(1,AccountingProProfit45.summarize(invoices,day.first,day.second).invoiceCount)
    }

    @Test fun customRangeIsInclusiveAndSupportsLoss() {
        val low=bill(items=listOf(line(price=50000L)),total=500000L)
        val result=AccountingProProfit45.summarize(listOf(low),
            LocalDate.of(2026,10,30),LocalDate.of(2026,10,30))
        assertEquals(-50000L,result.grossMerchandiseMarginVnd)
    }

    @Test fun largePricesCannotOverflowOrWrapProfit() {
        val huge=bill(items=listOf(line(qty=Int.MAX_VALUE,price=Long.MAX_VALUE,
            list=Long.MAX_VALUE)),total=Long.MAX_VALUE)
        val result=AccountingProProfit45.summarize(listOf(huge),yearStart,yearEnd)
        assertEquals(1,result.skippedCount)
        assertEquals(0L,result.grossMerchandiseMarginVnd)
    }

    @Test fun invalidDateExcludedAndDoesNotCountAsPeriod() {
        val result=AccountingProProfit45.summarize(listOf(bill(date="31/02/2026")),
            yearStart,yearEnd)
        assertEquals(0,result.invoiceCount)
    }

    @Test fun roundCompanyCostHalfUpPerUnitBeforeQuantity() {
        assertEquals(1L,AccountingProProfit45.unitCompanyCost(1L))
        assertEquals(2L,AccountingProProfit45.unitCompanyCost(3L))
        assertEquals(55000L,AccountingProProfit45.unitCompanyCost(100000L))
    }

    @Test fun inputRemainsUntouchedAndInvalidRangeFailsClosed() {
        val input=listOf(bill());val saved=input.toList()
        AccountingProProfit45.summarize(input,yearStart,yearEnd)
        assertEquals(saved,input)
        try {
            AccountingProProfit45.summarize(input,yearEnd,yearStart)
            fail("must reject reversed range")
        } catch(e:IllegalArgumentException) {
            assertTrue(e.message!!.contains("Ngày bắt đầu"))
        }
    }
}
