package vn.minhsatori.app

/**
 * Android-only, read-only exception queue. No scheduler, reminders, emails,
 * push notifications or debt-aging claims. Invoice issue dates are NOT due dates.
 */
enum class AccountingProAlertKind {
    IDENTITY, INVALID_DATE, MISSING_DELIVERY_CONTACT, UNPAID_LEGACY_FLAG, ZERO_TOTAL
}

data class AccountingProAlert(
    val invoice: SatoriInvoice,
    val kind: AccountingProAlertKind,
    val heading: String,
    val explanation: String,
    val needsReview: Boolean
)

object AccountingProAlertPolicy {
    fun fromSnapshot(invoices: List<SatoriInvoice>): List<AccountingProAlert> {
        val rows = AccountingProReadOnly.invoiceRows(invoices)
        return rows.flatMap { row ->
            val invoice = row.invoice
            buildList {
                if (row.needsIdentityReview) add(AccountingProAlert(
                    invoice, AccountingProAlertKind.IDENTITY,
                    "Cần kiểm tra định danh", row.reason, true))
                if (row.needsDateReview) add(AccountingProAlert(
                    invoice, AccountingProAlertKind.INVALID_DATE,
                    "Ngày hóa đơn không hợp lệ",
                    "Không thể xác định tuổi nợ khi ngày hóa đơn sai. " +
                        "Ngay cả ngày hợp lệ cũng KHÔNG phải hạn thanh toán.", true))
                if (invoice.phone.isBlank() && invoice.address.isBlank()) add(
                    AccountingProAlert(invoice, AccountingProAlertKind.MISSING_DELIVERY_CONTACT,
                        "Thiếu liên hệ giao hàng",
                        "Thiếu cả số điện thoại và địa chỉ. " +
                            "Không gửi nhắc nợ tự động theo tên.", true))
                if (invoice.total == 0L) add(AccountingProAlert(
                    invoice, AccountingProAlertKind.ZERO_TOTAL,
                    "Hóa đơn 0 đồng cần xem lại",
                    "Không tự sửa tổng tiền hoặc ghi doanh thu mới.", true))
                if (!invoice.customerHasPaid) add(AccountingProAlert(
                    invoice, AccountingProAlertKind.UNPAID_LEGACY_FLAG,
                    "Khách chưa đánh dấu trả đủ",
                    "Trạng thái cũ chỉ cho biết chưa đánh dấu trả đủ; " +
                        "không chứng minh quá hạn hoặc số dư sau trả một phần.", false))
            }
        }.sortedWith(compareByDescending<AccountingProAlert> { it.needsReview }
            .thenByDescending { it.invoice.sortDate })
    }

    fun countReviewIssues(alerts: List<AccountingProAlert>): Int =
        alerts.count { it.needsReview }

    fun countPendingFlagInvoices(alerts: List<AccountingProAlert>): Int =
        alerts.count { it.kind == AccountingProAlertKind.UNPAID_LEGACY_FLAG }
}
