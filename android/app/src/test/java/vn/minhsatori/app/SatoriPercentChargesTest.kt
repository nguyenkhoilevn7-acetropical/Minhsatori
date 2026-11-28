package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class SatoriPercentChargesTest {
    @Test fun vatEightPercentIsRoundedOnceToWholeDong() {
        // 7 cartons x 266,666 VND: VAT from goods, not total incl. shipping.
        val goods=SatoriOrderValidation.lineAmount(7L,266_666L)
        assertEquals(1_866_662L,goods)
        assertEquals(149_333L,SatoriPercentCharges.amount(goods,"8"))
        assertEquals(2_015_995L,SatoriOrderValidation.sum(goods,
            SatoriPercentCharges.amount(goods,"8")))
    }

    @Test fun shippingAndVatAreIndependentlyAppliedToGoods() {
        val goods=200_000L
        val shipping=SatoriPercentCharges.amount(goods,"8")
        val vat=SatoriPercentCharges.amount(goods,"8")
        assertEquals(16_000L,shipping)
        assertEquals(16_000L,vat)
        assertEquals(232_000L,SatoriOrderValidation.sum(goods,shipping,vat))
    }

    @Test fun fractionalPercentSupportsCommaAndDotAndHalfUpRounding() {
        assertEquals(16_640L,SatoriPercentCharges.amount(100_000L,"16,64"))
        assertEquals(16_640L,SatoriPercentCharges.amount(100_000L,"16.64%"))
        assertEquals(1L,SatoriPercentCharges.amount(6L,"8,34"))
        assertEquals(0L,SatoriPercentCharges.amount(6L,"8"))
        assertEquals(0L,SatoriPercentCharges.amount(1_000L,"0"))
    }

    @Test fun originalLegacyVndUnchangedWithoutPercentEdit() {
        val goods=1_866_662L
        // Earlier bill VAT stored at 149,332; derived 8% would round to 149,333.
        val before=149_332L
        val shown=SatoriPercentCharges.fromAmount(goods,before)
        assertEquals("8",shown)
        assertEquals(before,SatoriPercentCharges.charge(goods,shown,goods,before,false))
        assertEquals(149_333L,SatoriPercentCharges.charge(goods,shown,goods,before,true))
        assertEquals(149_333L,SatoriPercentCharges.charge(goods+1L,shown,goods,before,false))
    }

    @Test fun initialLegacyPercentForOtherValuesIsSensible() {
        assertEquals("2.5",SatoriPercentCharges.fromAmount(800_000L,20_000L))
        assertEquals("0",SatoriPercentCharges.fromAmount(100_000L,0L))
        assertEquals(20_000L,SatoriPercentCharges.charge(800_000L,"2.5",
            800_000L,20_000L,false))
        assertEquals(40_000L,SatoriPercentCharges.charge(800_000L,"5",
            800_000L,20_000L,true))
    }

    @Test fun rejectInvalidPercentOrOverflowInsteadOfSavingBadBill() {
        for (text in listOf("-1","101","8.123","abc","1,2,3","1e2","")) {
            try {
                SatoriPercentCharges.amount(100_000L,text)
                fail("Should reject: "+text)
            } catch (_:IllegalArgumentException) { }
        }
        try {
            SatoriPercentCharges.amount(-1,"8")
            fail("Negative goods cannot be accepted")
        } catch (_:IllegalArgumentException) { }
    }
}
