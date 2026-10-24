package vn.minhsatori.app

import org.junit.Assert.*
import org.junit.Test

class ProductionLedgerPolicyTest {
    private fun invoice(n: Int, test: Boolean = false) = SatoriInvoice(
        id = "row-$n", number = "$n", date = "2026-10-24",
        customer = "Demo $n", phone = "", address = "",
        status = "Chưa thanh toán", total = 0L, shipping = 0L, vat = 0L,
        lines = emptyList(), deliveryNote = "", customerPaidAt = "",
        duplicateFrom = "", isTest = test
    )
    @Test fun knownThreeBillSandboxCanNeverMasqueradeAsProduction() {
        val sample = SatoriSnapshot(2, "2026-10-24", (1..3).map { invoice(it) })
        assertNotNull(ProductionLedgerPolicy.rejection(sample))
        val spoofedRevision = sample.copy(revision = 133)
        assertNotNull(ProductionLedgerPolicy.rejection(spoofedRevision))
    }
    @Test fun live117BillSnapshotMatchesVerifiedProductionBaseline() {
        val live = SatoriSnapshot(133, "2026-10-24", (1..117).map { invoice(it) })
        assertNull(ProductionLedgerPolicy.rejection(live))
        assertNull(ProductionLedgerPolicy.rejection(live.copy(revision = 134)))
    }
    @Test fun olderLedgerNeverOverwritesKnownProductionBaseline() {
        val stale = SatoriSnapshot(132, "2026-10-22", (1..117).map { invoice(it) })
        assertNotNull(ProductionLedgerPolicy.rejection(stale))
    }
    @Test fun suspiciousDropAndTestOnlyLedgerRequireOwnerReview() {
        assertNotNull(ProductionLedgerPolicy.rejection(
            SatoriSnapshot(200, "2026-10-24", (1..3).map { invoice(it) })
        ))
        assertNotNull(ProductionLedgerPolicy.rejection(
            SatoriSnapshot(200, "2026-10-24", (1..117).map { invoice(it, test = true) })
        ))
    }
}
