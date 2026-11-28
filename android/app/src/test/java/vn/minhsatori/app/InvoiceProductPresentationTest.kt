package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class InvoiceProductPresentationTest {
    private fun line(
        name: String = "Nước tinh khiết Satori 350ml",
        price: Long = 65000,
        list: Long = 100000,
        discount: Double? = null
    ) = SatoriLine(name, 10, "Thùng", price, list, discountPercent = discount)

    @Test fun iconForWaterGuavaAndSoursopUsesProductName() {
        assertEquals(InvoiceProductPresentation.Icon.WATER,
            InvoiceProductPresentation.icon("Nước tinh khiết Satori 350ml"))
        assertEquals(InvoiceProductPresentation.Icon.GUAVA,
            InvoiceProductPresentation.icon("Ổi Hồng"))
        assertEquals(InvoiceProductPresentation.Icon.SOURSOP,
            InvoiceProductPresentation.icon("Mãng cầu"))
        assertEquals(InvoiceProductPresentation.Icon.DRINK,
            InvoiceProductPresentation.icon("Matcha latte"))
        assertEquals(InvoiceProductPresentation.Icon.PACKAGE,
            InvoiceProductPresentation.icon("Sản phẩm chưa phân loại"))
    }

    @Test fun storedDiscountHasPriorityOverDerivedPercent() {
        assertEquals(20.0, InvoiceProductPresentation.discountPercent(line(discount = 20.0))!!, 0.00001)
    }

    @Test fun derivesOnlyFromVerifiedListPriceAndUnitPrice() {
        assertEquals(35.0, InvoiceProductPresentation.discountPercent(line())!!, 0.00001)
        assertNull(InvoiceProductPresentation.discountPercent(line(list = 0)))
        assertNull(InvoiceProductPresentation.discountPercent(line(list = 60000)))
        assertEquals(0.0, InvoiceProductPresentation.discountPercent(line(list = 65000))!!, 0.00001)
    }

    @Test fun rejectsInvalidExplicitAndUnknownPrices() {
        assertNull(InvoiceProductPresentation.discountPercent(
            line(price = 65000, list = 0, discount = 150.0)))
        assertNull(InvoiceProductPresentation.discountPercent(
            line(price = 65000, list = 0, discount = Double.NaN)))
    }

    @Test fun invoiceDiscountDoesNotInventAWeightedPercent() {
        assertEquals("35%", InvoiceProductPresentation.invoiceDiscountLabel(listOf(line())))
        assertEquals("Theo từng sản phẩm",
            InvoiceProductPresentation.invoiceDiscountLabel(
                listOf(line(), line("Ổi hồng", 80000, 100000))))
        assertEquals("Theo từng sản phẩm",
            InvoiceProductPresentation.invoiceDiscountLabel(listOf(line(), line(list = 0))))
        assertEquals("Chưa có dữ liệu",
            InvoiceProductPresentation.invoiceDiscountLabel(listOf(line(list = 0))))
    }

    @Test fun decimalPercentAndSubtotalRemainPresentationOnly() {
        assertEquals("16,64%", InvoiceProductPresentation.formatPercent(16.64))
        val original = line(price = 65000, list = 100000, discount = 35.0)
        assertEquals(650000L, original.amount)
        InvoiceProductPresentation.invoiceDiscountLabel(listOf(original))
        assertEquals(650000L, original.amount)
    }
}
