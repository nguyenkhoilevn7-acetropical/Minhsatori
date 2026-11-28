package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class SatoriLineDiscountTest {
    @Test fun commonDiscountsAndReverseDisplay() {
        assertEquals("20", SatoriLineDiscount.fromPrices(98_000L, 78_400L))
        assertEquals(78_400L, SatoriLineDiscount.unitPrice(98_000L, "20"))
        assertEquals(83_300L, SatoriLineDiscount.unitPrice(98_000L, "15"))
        assertEquals(63_700L, SatoriLineDiscount.unitPrice(98_000L, "35"))
        assertEquals("35", SatoriLineDiscount.fromPrices(98_000L, 63_700L))
        assertEquals(98_000L, SatoriLineDiscount.unitPrice(98_000L, "0"))
        assertEquals(0L, SatoriLineDiscount.unitPrice(98_000L, "100"))
    }

    @Test fun fractionalDiscountAndWholeDongRounding() {
        assertEquals(85_750L, SatoriLineDiscount.unitPrice(98_000L, "12,5"))
        assertEquals(85_750L, SatoriLineDiscount.unitPrice(98_000L, "12.5"))
        assertEquals(2L, SatoriLineDiscount.unitPrice(3L, "50"))
        assertEquals(1_566_440L, SatoriLineDiscount.unitPrice(98_000L, "20.08") * 20L)
    }

    @Test fun inferredPercentIsDisplayOnlyAndMissingPriceIsNotInvented() {
        assertEquals("20", SatoriLineDiscount.fromPrices(98_000L, 78_401L))
        assertNotEquals(78_401L, SatoriLineDiscount.unitPrice(98_000L, "20"))
        assertEquals("", SatoriLineDiscount.fromPrices(0L, 78_400L))
        assertEquals("", SatoriLineDiscount.fromPrices(98_000L, 98_001L))
    }

    @Test fun rejectsInvalidRatesAndMissingListPrice() {
        for (raw in listOf("", "-1", "101", "10.123", "abc", "1e2", "100.01")) {
            try {
                SatoriLineDiscount.unitPrice(98_000L, raw)
                fail("Should reject: " + raw)
            } catch (_: IllegalArgumentException) { }
        }
        try {
            SatoriLineDiscount.unitPrice(0L, "20")
            fail("Missing list price")
        } catch (_: IllegalArgumentException) { }
    }
}
