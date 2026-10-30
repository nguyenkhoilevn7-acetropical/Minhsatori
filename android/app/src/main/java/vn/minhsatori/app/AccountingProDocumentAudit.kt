package vn.minhsatori.app

/**
 * App-only document metadata completeness audit.
 *
 * IMPORTANT: V1 SatoriInvoice does not contain a verified Drive PDF archive
 * reference, transactional email delivery log, electronic invoice UUID/XML
 * or Vietnamese tax-authority issuance status. VAT/tax code fields alone are
 * NOT evidence of legally issued electronic invoices.
 *
 * Never generate, send, archive, sign or publish any document from this model.
 */
enum class AccountingProDocumentProof { NOT_AVAILABLE_IN_SNAPSHOT }

data class AccountingProDocumentReviewRow(
    val invoice: SatoriInvoice,
    val identityReliable: Boolean,
    val hasVatAmountField: Boolean,
    val hasTaxCodeField: Boolean,
    val archivedPdfProof: AccountingProDocumentProof =
        AccountingProDocumentProof.NOT_AVAILABLE_IN_SNAPSHOT,
    val emailDeliveryProof: AccountingProDocumentProof =
        AccountingProDocumentProof.NOT_AVAILABLE_IN_SNAPSHOT,
    val legalEInvoiceProof: AccountingProDocumentProof =
        AccountingProDocumentProof.NOT_AVAILABLE_IN_SNAPSHOT
)
data class AccountingProDocumentReadiness(
    val validSaleInvoices: Int,
    val excludedInvoices: Int,
    val rowsWithVatAmount: Int,
    val rowsWithTaxCode: Int,
    val unreliableInvoiceIds: Int,
    val verifiedArchivedPdfCount: Int? = null,
    val verifiedEmailDeliveredCount: Int? = null,
    val verifiedLegalEInvoiceCount: Int? = null
)

object AccountingProDocumentAudit {
    fun rows(invoices: List<SatoriInvoice>): List<AccountingProDocumentReviewRow> =
        AccountingProReadOnly.invoiceRows(invoices).map { review ->
            AccountingProDocumentReviewRow(
                invoice = review.invoice,
                identityReliable = review.identityReliable,
                hasVatAmountField = review.invoice.vat > 0L,
                hasTaxCodeField = review.invoice.taxCode.isNotBlank()
            )
        }

    fun summary(invoices: List<SatoriInvoice>): AccountingProDocumentReadiness {
        val checked = rows(invoices)
        return AccountingProDocumentReadiness(
            validSaleInvoices = checked.size,
            excludedInvoices = invoices.size - checked.size,
            rowsWithVatAmount = checked.count { it.hasVatAmountField },
            rowsWithTaxCode = checked.count { it.hasTaxCodeField },
            unreliableInvoiceIds = checked.count { !it.identityReliable }
            // All externally verified document statuses are intentionally null.
        )
    }
}
