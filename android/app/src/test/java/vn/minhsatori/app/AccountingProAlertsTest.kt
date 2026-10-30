package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountingProAlertsTest {
    private fun bill(
        id: String = "canonical-1", no: String = "5901",
        status: String = "Chưa thanh toán",
        total: Long = 100000L,
        date: String = "2026-10-30",
        phone: String = "0900000000",
        address: String = "Địa chỉ demo",
        pairRole: String = "",
        test: Boolean = false
    ) = SatoriInvoice(
        id=id, number=no, date=date, customer="Khách demo",
        phone=phone, address=address, status=status, total=total,
        shipping=0, vat=0, lines=emptyList(), deliveryNote="",
        customerPaidAt="", duplicateFrom="", pairRole=pairRole,isTest=test
    )

    @Test fun legacyUnpaidIsNotOverdueOrVerifiedCashBalance() {
        val alerts=AccountingProAlertPolicy.fromSnapshot(listOf(bill()))
        assertEquals(1,alerts.size)
        assertEquals(AccountingProAlertKind.UNPAID_LEGACY_FLAG,alerts[0].kind)
        assertFalse(alerts[0].needsReview)
        assertTrue(alerts[0].explanation.contains("không chứng minh quá hạn"))
    }

    @Test fun independentSatoriSettlementDoesNotClearCustomerUnpaidFlag() {
        val row=bill(status="Đã TT Satori")
        val alerts=AccountingProAlertPolicy.fromSnapshot(listOf(row))
        assertEquals(1,AccountingProAlertPolicy.countPendingFlagInvoices(alerts))
    }

    @Test fun paidInvoiceIsNotReminded() {
        val alerts=AccountingProAlertPolicy.fromSnapshot(
            listOf(bill(status="Đã thanh toán")))
        assertTrue(alerts.isEmpty())
    }

    @Test fun duplicateInvoiceNumberIsFlaggedForEachRow() {
        val alerts=AccountingProAlertPolicy.fromSnapshot(listOf(
            bill(),bill(id="canonical-2")))
        assertEquals(2,alerts.count { it.kind == AccountingProAlertKind.IDENTITY })
        assertEquals(2,AccountingProAlertPolicy.countReviewIssues(alerts))
    }

    @Test fun badDateNeverBecomesAFalseOverdueReminder() {
        val alerts=AccountingProAlertPolicy.fromSnapshot(
            listOf(bill(status="Đã thanh toán",date="30/02/2026")))
        assertEquals(1,alerts.size)
        assertEquals(AccountingProAlertKind.INVALID_DATE,alerts[0].kind)
        assertTrue(alerts[0].explanation.contains("KHÔNG phải hạn thanh toán"))
    }

    @Test fun missingContactIsDataReviewNotPermissionToSendEmail() {
        val alerts=AccountingProAlertPolicy.fromSnapshot(
            listOf(bill(status="Đã thanh toán",phone="",address="")))
        assertEquals(1,alerts.size)
        assertEquals(AccountingProAlertKind.MISSING_DELIVERY_CONTACT,alerts[0].kind)
        assertTrue(alerts[0].needsReview)
    }

    @Test fun excludedInternalAndTestInvoicesNeverAppear() {
        val alerts=AccountingProAlertPolicy.fromSnapshot(listOf(
            bill(pairRole="collaborator"),bill(id="other",no="5902",test=true),
            bill(id="void",no="5903",status="Đã hủy")
        ))
        assertTrue(alerts.isEmpty())
    }

    @Test fun zeroTotalRequiresReviewButDoesNotCreateDebt() {
        val alerts=AccountingProAlertPolicy.fromSnapshot(
            listOf(bill(status="Đã thanh toán",total=0L)))
        assertEquals(1,alerts.size)
        assertEquals(AccountingProAlertKind.ZERO_TOTAL,alerts[0].kind)
    }

    @Test fun sourceSnapshotRemainsUnchanged() {
        val rows=listOf(bill(),bill(id="canonical-2",no="5902",status="Đã thanh toán"))
        val clone=rows.toList()
        AccountingProAlertPolicy.fromSnapshot(rows)
        assertEquals(clone,rows)
    }
}
