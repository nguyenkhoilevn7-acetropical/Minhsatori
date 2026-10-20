package vn.minhsatori.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class MobileWriteOutcomeTest {
    @Test fun committedButUnverifiedIsNeverARejectedWrite() {
        assertTrue(MobileWriteOutcome.requiresReconciliation(
            MobileApiError("COMMIT_UNVERIFIED", "Drive đã ghi nhưng chưa xác minh")))
    }

    @Test fun genericServerFailureAndReplayNeedAuthoritativeReadback() {
        for (code in listOf("ERROR", "INVALID_STATE", "REPLAYED", "", "NEW_SERVER_ERROR")) {
            assertTrue(code, MobileWriteOutcome.requiresReconciliation(MobileApiError(code, "test")))
        }
    }

    @Test fun lostNetworkReplyMayHaveCommitted() {
        assertTrue(MobileWriteOutcome.requiresReconciliation(IOException("timeout after commit")))
    }

    @Test fun rejectedBeforeWriteDoesNotPretendToBeAnUnknownCommit() {
        for (code in listOf("AUTH_FAILED", "FORBIDDEN", "REVISION_CONFLICT", "BACKUP_FAILED",
            "TOTAL_MISMATCH", "PAID_ORDER_PROTECTED", "PROFILE_MISMATCH")) {
            assertFalse(code, MobileWriteOutcome.requiresReconciliation(MobileApiError(code, "test")))
        }
    }

    @Test fun rejectedRetryDoesNotEraseAnEarlierUncertainOperation() {
        for (code in listOf("AUTH_FAILED", "FORBIDDEN", "REVISION_CONFLICT", "ORDER_CHANGED")) {
            val error = MobileApiError(code, "test")
            assertFalse(MobileWriteOutcome.mayDiscardAfterRejection(error, true))
            assertTrue(MobileWriteOutcome.mayDiscardAfterRejection(error, false))
        }
        assertFalse(MobileWriteOutcome.mayDiscardAfterRejection(IOException("lost reply"), false))
    }
}
