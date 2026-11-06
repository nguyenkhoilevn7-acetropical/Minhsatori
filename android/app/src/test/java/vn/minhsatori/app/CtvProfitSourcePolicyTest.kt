package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class CtvProfitSourcePolicyTest {
    private fun sampleInvoice()=SatoriInvoice(
        id="5966-real-immutable-id",number="5966",date="01/11/2026",
        customer="Hà Minh Nguyệt",phone="919989887",
        address="Delivery recipient",status="Chưa thanh toán",
        total=2_879_993L,shipping=0L,vat=213_333L,
        lines=listOf(
            SatoriLine("Mãng cầu",3,"Thùng",266_666,333_333),
            SatoriLine("Ổi hồng",7,"Thùng",266_666,333_333)),
        deliveryNote="",customerPaidAt="",duplicateFrom=""
    )
    private fun partner()=SatoriCollaborator(
        "registered-ctv","Hà Minh Nguyệt","0988888888",35.0)
    private fun snapshot(withRegistry:Boolean)=SatoriSnapshot(
        205,"",listOf(sampleInvoice()),collaborators=
            if(withRegistry) listOf(partner()) else emptyList(),
        collaboratorRegistryLoaded=withRegistry)

    @Test fun oldMobileApiCannotPresentGrossProfitAsNet() {
        val api=snapshot(false)
        val rows=CtvProfitSourcePolicy.profitRows(api)
        assertEquals(1,rows.size)
        assertNull(rows.single().estimatedOwnerMarginVnd)
        assertNull(rows.single().estimatedCtvCommissionVnd)
        assertTrue(rows.single().reason!!.contains("hồ sơ CTV"))
    }

    @Test fun selfContainedApprovedCtvDiscountCanBeCountedWithoutRegistry() {
        val explicit=sampleInvoice().copy(
            collaboratorId="registered-ctv",
            pairDiscountPercent=35.0
        )
        val rows=CtvProfitSourcePolicy.profitRows(
            snapshot(false).copy(invoices=listOf(explicit)))
        assertEquals(1,rows.size)
        assertEquals(333_333L,rows.single().estimatedOwnerMarginVnd)
        assertEquals(499_995L,rows.single().estimatedCtvCommissionVnd)
    }

    @Test fun incompleteOlderInvoiceIsSkippedWhileNewVerifiedInvoiceIsCounted() {
        val valid=sampleInvoice().copy(
            collaboratorId="registered-ctv",pairDiscountPercent=35.0)
        val old=sampleInvoice().copy(
            id="older-legacy",number="5900",date="30/10/2026",
            collaboratorId="",pairDiscountPercent=null)
        val rows=CtvProfitSourcePolicy.profitRows(
            snapshot(false).copy(invoices=listOf(old,valid)))
        val total=AccountingProMargin45.summarize(
            rows,AccountingProMargin45Period.all())
        assertEquals(2,total.totalInvoiceCount)
        assertEquals(1,total.computedInvoiceCount)
        assertEquals(1,total.missingInvoiceCount)
        assertEquals(333_333L,total.estimatedMarginKnownVnd)
        assertNull(rows.first().estimatedOwnerMarginVnd)
    }

    @Test fun matchingVerifiedDriveRestoresActualOwnerNetMargin() {
        val api=snapshot(false)
        val verifiedDrive=snapshot(true)
        val restored=CtvProfitSourcePolicy.recover(api,verifiedDrive)
        assertNotNull(restored)
        assertTrue(restored!!.collaboratorRegistryLoaded)
        assertEquals(1,restored.collaborators.size)
        val row=CtvProfitSourcePolicy.profitRows(restored).single()
        assertEquals(833_328L,row.saleGoodsVnd!!-row.estimatedPurchaseVnd!!)
        assertEquals(499_995L,row.estimatedCtvCommissionVnd)
        assertEquals(333_333L,row.estimatedOwnerMarginVnd)
    }

    @Test fun changedRevisionOrDifferentInvoiceIsNeverBridged() {
        val api=snapshot(false)
        assertNull(CtvProfitSourcePolicy.recover(api,snapshot(true).copy(revision=206)))
        assertNull(CtvProfitSourcePolicy.recover(api,snapshot(true).copy(
            invoices=listOf(sampleInvoice().copy(total=2_879_992L)))))
        assertNull(CtvProfitSourcePolicy.recover(api,snapshot(true).copy(
            products=listOf(SatoriProduct("P","Wrong","Thùng",1,2)))))
        assertNull(CtvProfitSourcePolicy.recover(api,snapshot(false)))
    }

    @Test fun sourceParserDistinguishesAbsentRegistryFromEmptyOrMalformedRegistry() {
        fun raw(registry:String?):String {
            val values=JSONObject().put("satori_orders_v15","[]")
            if(registry!=null)values.put("satori_collaborators_v1",registry)
            return JSONObject().put("revision",205).put("values",values).toString()
        }
        val absent=SatoriData.fromDriveState(raw(null))
        val empty=SatoriData.fromDriveState(raw("[]"))
        assertFalse(absent.collaboratorRegistryLoaded)
        assertTrue(empty.collaboratorRegistryLoaded)
        assertTrue(empty.collaborators.isEmpty())
        try {
            SatoriData.fromDriveState(raw("malformed"))
            fail("Malformed CTV data must never silently become empty.")
        } catch (_: IllegalArgumentException) { }
    }

    @Test fun emptyRegistryFromOutdatedApiCannotMislabelGrossProfit() {
        val staleApi=snapshot(true).copy(collaborators=emptyList())
        assertNull(CtvProfitSourcePolicy.profitRows(staleApi)
            .single().estimatedOwnerMarginVnd)
        val recovered=CtvProfitSourcePolicy.recover(staleApi,snapshot(true))
        assertEquals(333_333L,CtvProfitSourcePolicy.profitRows(recovered!!)
            .single().estimatedOwnerMarginVnd)
    }

    @Test fun callerCannotOverwriteAlreadyVerifiedRegistryFromUntrustedSecondSource() {
        val trusted=snapshot(true)
        val replacement=snapshot(false)
        assertSame(trusted,CtvProfitSourcePolicy.recover(trusted,replacement))
    }
}
