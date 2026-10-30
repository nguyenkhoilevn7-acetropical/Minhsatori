package vn.minhsatori.app

/**
 * Accounting Pro phase 3 — CTV/profit source-quality audit, read-only.
 *
 * The current Android canonical snapshot contains invoice prices and some
 * historical CTV pair metadata, but NO verified purchase-cost, commission
 * liability, bank-settlement or shipping-expense ledger. Therefore it cannot
 * truthfully calculate profit or "amount owed to CTV" from invoice totals.
 *
 * A historical internal collaborator invoice is a reference, NOT another sale.
 * This projection never sends a payment or changes the canonical record.
 */
data class AccountingProProfitReviewRow(
    val invoice: SatoriInvoice,
    val identityReliable: Boolean,
    val hasLegacyCtvMetadata: Boolean,
    val legacyPairVerified: Boolean,
    val pairNeedsReview: Boolean,
    val missingProductDetail: Boolean,
    val historicalCtvLabel: String
)

data class AccountingProProfitReadiness(
    val activeSaleCount: Int,
    val excludedInternalBillCount: Int,
    val legacyCtvReferenceCount: Int,
    val legacyPairsNeedingReviewCount: Int,
    val invalidInvoiceIdentityCount: Int,
    val missingProductDetailCount: Int,
    val grossInvoiceTotalVnd: Long?,
    val verifiedPurchaseCostVnd: Long? = null,
    val verifiedCommissionLiabilityVnd: Long? = null,
    val verifiedDeliveryExpenseVnd: Long? = null,
    val verifiedNetProfitVnd: Long? = null
)

/** No customer/CTV role is inferred from a missing legacy collaborator ID. */
object AccountingProProfitAudit {
    fun rows(invoices: List<SatoriInvoice>): List<AccountingProProfitReviewRow> {
        val valid = AccountingProReadOnly.invoiceRows(invoices)
        return valid.map { review ->
            val invoice = review.invoice
            val ctv = invoice.collaboratorId.isNotBlank() ||
                invoice.isCustomerPairBill || invoice.pairGroupId.isNotBlank() ||
                invoice.pairCollaboratorName.isNotBlank()
            val pair = invoice.isCustomerPairBill
            val match = if (!pair) false else invoices.filter { partner ->
                partner.isInternalCollaboratorBill &&
                    partner.pairGroupId.isNotBlank() &&
                    partner.pairGroupId == invoice.pairGroupId &&
                    partner.pairInvoiceNo == invoice.number &&
                    invoice.pairInvoiceNo == partner.number &&
                    partner.collaboratorId.isNotBlank() &&
                    partner.collaboratorId == invoice.collaboratorId &&
                    partner.total >= 0L &&
                    invoice.total > partner.total &&
                    SatoriData.normalized(invoice.address) ==
                        SatoriData.normalized(partner.address)
            }.size == 1
            AccountingProProfitReviewRow(
                invoice = invoice,
                identityReliable = review.identityReliable,
                hasLegacyCtvMetadata = ctv,
                legacyPairVerified = match,
                pairNeedsReview = pair && !match ||
                    (!pair && (invoice.pairGroupId.isNotBlank() ||
                        invoice.pairInvoiceNo.isNotBlank())),
                missingProductDetail = invoice.lines.isEmpty() ||
                    invoice.lines.any { it.quantity <= 0 || it.description.isBlank() },
                historicalCtvLabel = invoice.pairCollaboratorName
                    .ifBlank { invoice.collaboratorId.ifBlank {
                        if (ctv) "CTV cũ (chưa rõ tên)" else "Chưa có dữ liệu CTV"
                    } }
            )
        }
    }

    fun summary(invoices: List<SatoriInvoice>): AccountingProProfitReadiness {
        val rows = rows(invoices)
        val legacyTotals = AccountingProReadOnly.summarize(invoices)
        return AccountingProProfitReadiness(
            activeSaleCount = rows.size,
            excludedInternalBillCount = invoices.count { it.isInternalCollaboratorBill },
            legacyCtvReferenceCount = rows.count { it.hasLegacyCtvMetadata },
            legacyPairsNeedingReviewCount = rows.count { it.pairNeedsReview },
            invalidInvoiceIdentityCount = rows.count { !it.identityReliable },
            missingProductDetailCount = rows.count { it.missingProductDetail },
            grossInvoiceTotalVnd = legacyTotals.grossByLegacyFlags
            // Financial figures remain null because cost, VAT-exclusive sales,
            // shipping expenses and approved commission ledger are unavailable.
        )
    }
}
