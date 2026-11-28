package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class InvoiceScreenFilterTest {
    private fun sample(no: Int, status: String, date: String = "02/11/2026",
                       created: Long? = null, customerPaidAt: String = "",
                       satoriPaidAt: String = "") =
        SatoriInvoice(id = "fake-$no", number = no.toString(), date = date,
            customer = "Khách giả lập $no", phone = "0000000000",
            address = "Địa chỉ giả", status = status, total = 1000,
            shipping = 0, vat = 0, lines = emptyList(),
            deliveryNote = "", customerPaidAt = customerPaidAt,
            satoriPaidAt = satoriPaidAt, creationTimestampMillis = created,
            duplicateFrom = "")

    @Test fun paymentButtonsReflectCustomerAndSatoriIndependently() {
        val unpaid=sample(31,"Chưa thanh toán")
        val paid=sample(32,"Đã thanh toán")
        val companyOnly=sample(33,"Đã TT Satori")
        val cancelled=sample(34,"Đã hủy")
        val excluded=sample(35,"Không Tính")
        val source=listOf(unpaid,paid,companyOnly,cancelled,excluded)
        assertEquals(listOf("33","31"),InvoiceScreenFilter.apply(source,1,"").map{it.number})
        assertEquals(listOf("32"),InvoiceScreenFilter.apply(source,2,"").map{it.number})
        assertEquals(listOf("33"),InvoiceScreenFilter.apply(source,3,"").map{it.number})
        assertEquals(listOf("35"),InvoiceScreenFilter.apply(source,4,"").map{it.number})
        assertEquals(listOf("34"),InvoiceScreenFilter.apply(source,5,"").map{it.number})
        assertEquals(5,InvoiceScreenFilter.apply(source,0,"").size)
    }

    @Test fun sortsDateThenSubmittedTimeThenInvoiceNumber() {
        val older=sample(101,"Đã thanh toán", date="30/10/2026")
        val early=sample(102,"Đã thanh toán", created=1793611000000)
        val late=sample(103,"Đã thanh toán", created=1793612000000)
        val ties=sample(104,"Đã thanh toán", created=1793612000000)
        assertEquals(listOf("104","103","102","101"),
            InvoiceScreenFilter.apply(listOf(older,early,late,ties),2,"").map{it.number})
    }

    @Test fun searchAppliesAfterStatusWithoutMutatingLedger() {
        val source=listOf(sample(41,"Đã thanh toán"),sample(42,"Chưa thanh toán"))
        assertEquals(listOf("41"),InvoiceScreenFilter.apply(source,2,"41").map{it.number})
        assertTrue(InvoiceScreenFilter.apply(source,1,"41").isEmpty())
        assertEquals(2,source.size)
    }
}
