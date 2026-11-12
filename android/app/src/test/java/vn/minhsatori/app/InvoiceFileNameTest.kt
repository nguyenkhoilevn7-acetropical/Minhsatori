package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class InvoiceFileNameTest {
    @Test
    fun onlyInvoiceNumberRecipientAndOrderDate() {
        assertEquals("5989_Cong_ty_TNHH_Nha_Hang_Thanh_12-11-2026.pdf",
            InvoiceFileName.pdf("5989", "Công ty TNHH Nhà Hàng Thạnh", "12/11/2026"))
        assertEquals("5989_18_12-11-2026.pdf", InvoiceFileName.pdf("5989", "18+", "12/11/2026"))
        assertEquals("6001_Dang_Van_Duc_03-01-2027.pdf",
            InvoiceFileName.pdf("#6001", "  Đặng Văn Đức ", "3/1/2027"))
    }

    @Test
    fun isoDatesAndUnsafeCharactersAreNormalised() {
        assertEquals("42_A_B_C_05-11-2026.pdf", InvoiceFileName.pdf("42", "A/B:C*?", "2026-11-05"))
        assertEquals("42_Khach_05-11-2026.pdf", InvoiceFileName.pdf("42", "  ", "05/11/2026"))
    }

    @Test
    fun neverContainsUuidPrefixOrUnsafeCharacters() {
        val name = InvoiceFileName.pdf("5989", "Khách \"VIP\" <Quận 2> | Cát Lái", "12/11/2026")
        assertEquals("5989_Khach_VIP_Quan_2_Cat_Lai_12-11-2026.pdf", name)
        assertTrue(Regex("^[A-Za-z0-9_-]+\\.pdf$").matches(name))
        val long = InvoiceFileName.pdf("7", "x".repeat(300), "12/11/2026")
        assertTrue(long.length <= 7 + 1 + 60 + 1 + 10 + 4)
    }

    @Test
    fun usesTheLedgerFieldsOfAnInvoice() {
        val invoice = SatoriInvoice(id = "1", number = "5989", date = "12/11/2026", customer = "18+",
            phone = "", address = "", status = "Chưa thanh toán", total = 0, shipping = 0, vat = 0,
            lines = emptyList(), deliveryNote = "", customerPaidAt = "", duplicateFrom = "")
        assertEquals("5989_18_12-11-2026.pdf", InvoiceFileName.pdf(invoice))
    }
}
