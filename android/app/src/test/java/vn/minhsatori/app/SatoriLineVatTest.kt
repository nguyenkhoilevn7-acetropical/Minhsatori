package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SatoriLineVatTest {
    @Test fun computesVatIndependentlyForEachInvoiceLine() {
        assertEquals(1600L, SatoriPercentCharges.amount(20000L, "8"))
        assertEquals(0L, SatoriPercentCharges.amount(5000L, "0"))
        assertEquals(1650L, SatoriPercentCharges.amount(30000L, "5.5"))
        assertEquals(3250L,
            listOf(
                SatoriPercentCharges.amount(20000L, "8"),
                SatoriPercentCharges.amount(5000L, "0"),
                SatoriPercentCharges.amount(30000L, "5.5")
            ).sum())
    }

    @Test fun usesWholeVndHalfUpRoundingPerLine() {
        assertEquals(73L, SatoriPercentCharges.amount(1000L, "7.25"))
        assertEquals(1L, SatoriPercentCharges.amount(10L, "5"))
        assertEquals(0L, SatoriPercentCharges.amount(1L, "5"))
    }

    @Test fun rejectsRatesOutsideTheSupportedRangeOrPrecision() {
        listOf("-0.01", "100.01", "1.234", "abc", "").forEach { invalid ->
            assertThrows(IllegalArgumentException::class.java) {
                SatoriPercentCharges.amount(10000L, invalid)
            }
        }
    }

    @Test fun legacyAggregateVatCanBeConvertedToAnInitialLineRate() {
        assertEquals("8", SatoriPercentCharges.fromAmount(20000L, 1600L))
        assertEquals("0", SatoriPercentCharges.fromAmount(20000L, 0L))
    }
}
