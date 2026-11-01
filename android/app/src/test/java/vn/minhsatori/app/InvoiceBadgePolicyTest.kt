package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class InvoiceBadgePolicyTest {
    private fun row(no: Long, valid: Boolean = true) = InvoiceBadgeEntry(no, valid)

    @Test fun firstVerifiedSnapshotIsBaselineNotHundredsOfUnreadBills() {
        val update = InvoiceBadgePolicy.reconcile(InvoiceBadgeState(),
            listOf(row(5900), row(5901), row(5961), row(5962, false)))
        assertEquals(5962L, update.state.highWater)
        assertEquals(0, update.state.count)
        assertTrue(update.fresh.isEmpty())
    }

    @Test fun emptyVerifiedLedgerTracksFirstLiveInvoice() {
        val initial = InvoiceBadgePolicy.reconcile(InvoiceBadgeState(), emptyList())
        assertEquals(0L, initial.state.highWater)
        val new = InvoiceBadgePolicy.reconcile(initial.state, listOf(row(1)))
        assertEquals(setOf(1L), new.fresh)
        assertEquals(1, new.state.count)
    }

    @Test fun newRealGeminiInvoiceAppearsOnceAndSurvivesNewSnapshot() {
        val baseline = InvoiceBadgeState(5960L)
        val first = InvoiceBadgePolicy.reconcile(baseline, listOf(row(5960), row(5961)))
        assertEquals(setOf(5961L), first.fresh)
        assertEquals(setOf(5961L), first.state.unread)
        val next = InvoiceBadgePolicy.reconcile(first.state, listOf(row(5960), row(5961)))
        assertTrue(next.fresh.isEmpty())
        assertEquals(1, next.state.count)
    }

    @Test fun excludesTestsInternalCtvAndCancelledInvoicesFromUnreadCount() {
        val result=InvoiceBadgePolicy.reconcile(InvoiceBadgeState(5961),
            listOf(row(5962, false), row(5963, false), row(5964), row(5965, false)))
        assertEquals(5965L, result.state.highWater)
        assertEquals(setOf(5964L), result.fresh)
        assertEquals(1, result.state.count)
    }

    @Test fun markerDoesNotResetOnStaleReplayedOrDeletedInvoices() {
        val last=InvoiceBadgeState(5965L, setOf(5964L))
        val update=InvoiceBadgePolicy.reconcile(last, listOf(row(5961), row(5965)))
        assertEquals(5965L, update.state.highWater)
        assertTrue(update.fresh.isEmpty())
        assertEquals(0, update.state.count)
    }

    @Test fun viewingInvoiceTabClearsBadgeButDoesNotSuppressFutureOrders() {
        val state=InvoiceBadgeState(5966L,setOf(5964L,5966L))
        val read=InvoiceBadgePolicy.acknowledgeAll(state)
        assertEquals(0,read.count)
        assertEquals(5966L,read.highWater)
        val new=InvoiceBadgePolicy.reconcile(read,listOf(row(5966),row(5967)))
        assertEquals(setOf(5967L),new.fresh)
        assertEquals(1,new.state.count)
    }

    @Test fun readingOneCardClearsOnlyItsBadgeAndFutureOrdersStillAlert() {
        val starting = InvoiceBadgeState(5962L, setOf(5961L, 5962L))
        val read = InvoiceBadgePolicy.acknowledgeOne(starting, 5962L)
        assertEquals(setOf(5961L), read.unread)
        assertEquals(5962L, read.highWater)
        val refreshed = InvoiceBadgePolicy.reconcile(
            read, listOf(row(5961), row(5962)))
        assertEquals(setOf(5961L), refreshed.state.unread)
        assertTrue(refreshed.fresh.isEmpty())
        val another = InvoiceBadgePolicy.reconcile(
            refreshed.state, listOf(row(5961), row(5962), row(5963)))
        assertEquals(setOf(5961L, 5963L), another.state.unread)
        val last = InvoiceBadgePolicy.acknowledgeOne(another.state, 5961L)
        assertEquals(setOf(5963L), last.unread)
    }

    @Test fun paymentOrEditingSameNumberCannotGenerateFalseNewInvoice() {
        val old=InvoiceBadgeState(5967L)
        val result=InvoiceBadgePolicy.reconcile(old,listOf(row(5967),row(5966)))
        assertTrue(result.fresh.isEmpty())
        assertEquals(0,result.state.count)
    }

    @Test fun blockedAndroidNotificationLeavesOfficialInvoicePending() {
        val verified = InvoiceBadgePolicy.reconcile(InvoiceBadgeState(5960L),
            listOf(row(5960L), row(5961L)))
        // OS permission was denied: do not call afterAccepted.
        assertEquals(setOf(5961L),
            InvoiceNotificationDeliveryPolicy.pending(verified.state.unread, emptySet()))
        // Subsequent verified sync has no new high-water, but the missed alert
        // must still be eligible after the owner enables notifications.
        val replay = InvoiceBadgePolicy.reconcile(verified.state,
            listOf(row(5960L), row(5961L)))
        assertTrue(replay.fresh.isEmpty())
        assertEquals(setOf(5961L),
            InvoiceNotificationDeliveryPolicy.pending(replay.state.unread, emptySet()))
    }

    @Test fun successfulPostCannotNotifyTheSameInvoiceTwice() {
        val unread = setOf(5961L, 5962L)
        val accepted = InvoiceNotificationDeliveryPolicy.afterAccepted(unread)
        assertTrue(InvoiceNotificationDeliveryPolicy.pending(unread, accepted).isEmpty())
        assertEquals(setOf(5963L),
            InvoiceNotificationDeliveryPolicy.pending(unread + 5963L, accepted))
    }

    @Test fun readingOneInvoiceDoesNotAcknowledgeOtherUndeliveredOrder() {
        val unread = setOf(5961L, 5962L)
        val next = InvoiceBadgePolicy.acknowledgeOne(
            InvoiceBadgeState(5962L, unread), 5961L)
        assertEquals(setOf(5962L), InvoiceNotificationDeliveryPolicy.pending(
            next.unread, emptySet()))
        assertTrue(InvoiceNotificationDeliveryPolicy.pending(
            InvoiceBadgePolicy.acknowledgeAll(next).unread, emptySet()).isEmpty())
    }

}
