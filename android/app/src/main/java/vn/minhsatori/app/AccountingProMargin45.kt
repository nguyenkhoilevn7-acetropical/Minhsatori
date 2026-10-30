package vn.minhsatori.app

import java.math.BigInteger
import java.time.LocalDate

/**
 * Owner-only estimate from historically stored invoice item list prices.
 * Supplier agreement: 45% off listed price, so the purchase BASIS is 55%.
 *
 * Estimate is NOT net profit: excludes shipping expenses, overhead, taxes,
 * rebates/returns and any unbooked CTV liability. Never sends financial writes.
 */
data class AccountingProMargin45Row(
    val invoice: SatoriInvoice,
    val saleGoodsVnd: Long?,
    val estimatedPurchaseVnd: Long?,
    val estimatedCtvCommissionVnd: Long?,
    val estimatedOwnerMarginVnd: Long?,
    val reason: String? = null
)
data class AccountingProMargin45Period(
    val title: String,
    val from: LocalDate? = null,
    val through: LocalDate? = null
) {
    init { require(from == null || through == null || !from.isAfter(through)) }
    fun includes(invoice: SatoriInvoice): Boolean {
        if (!invoice.hasValidDate) return false
        val ymd=invoice.sortDate
        val date=runCatching {
            LocalDate.of(ymd.substring(0,4).toInt(),ymd.substring(4,6).toInt(),
                ymd.substring(6,8).toInt())
        }.getOrNull() ?: return false
        return (from == null || !date.isBefore(from)) &&
            (through == null || !date.isAfter(through))
    }
    companion object {
        fun all()=AccountingProMargin45Period("Tất cả")
        fun day(d: LocalDate)=AccountingProMargin45Period("Ngày $d",d,d)
        fun month(y: Int,m: Int): AccountingProMargin45Period {
            val start=LocalDate.of(y,m,1)
            return AccountingProMargin45Period("Tháng $m/$y",
                start,start.withDayOfMonth(start.lengthOfMonth()))
        }
        fun year(y: Int)=AccountingProMargin45Period("Năm $y",
            LocalDate.of(y,1,1),LocalDate.of(y,12,31))
        fun custom(from:LocalDate,to:LocalDate):AccountingProMargin45Period {
            require(!from.isAfter(to)) { "Khoảng ngày không hợp lệ." }
            return AccountingProMargin45Period("Từ $from đến $to",from,to)
        }
    }
}
data class AccountingProMargin45Summary(
    val period: AccountingProMargin45Period,
    val totalInvoiceCount: Int,
    val computedInvoiceCount: Int,
    val missingInvoiceCount: Int,
    val excludedInvalidDates: Int,
    val estimatedMarginKnownVnd: Long?,
    val fullyCovered: Boolean
)

/**
 * No double counting: excludes internal CTV price-reference bills entirely.
 * No guessed partner: pair matching requires exact IDs + basket, product and
 * delivery. A single-invoice CTV with an approved discount snapshot may be
 * estimated; an unknown CTV discount is a missing-data result, never 0.
 */
object AccountingProMargin45 {
    const val SUPPLIER_DISCOUNT_PERCENT = 45
    private val HUNDRED=BigInteger.valueOf(100L)
    private val LONG_MIN=BigInteger.valueOf(Long.MIN_VALUE)
    private val LONG_MAX=BigInteger.valueOf(Long.MAX_VALUE)

    private fun checked(v: BigInteger): Long? =
        if(v < LONG_MIN || v > LONG_MAX) null else v.toLong()
    private fun goods(invoice: SatoriInvoice): Pair<BigInteger,BigInteger>? {
        if (invoice.lines.isEmpty()) return null
        var sold=BigInteger.ZERO
        var listed=BigInteger.ZERO
        for (item in invoice.lines) {
            if (item.quantity <= 0 || item.unitPrice < 0 || item.listPrice <= 0L ||
                item.description.isBlank()) return null
            val qty=BigInteger.valueOf(item.quantity.toLong())
            sold=sold.add(qty.multiply(BigInteger.valueOf(item.unitPrice)))
            listed=listed.add(qty.multiply(BigInteger.valueOf(item.listPrice)))
        }
        // Exclude VAT and charged shipping. If the invoice item snapshot no
        // longer agrees with the bill, refuse a deceptively precise profit.
        val expected=sold
            .add(BigInteger.valueOf(invoice.shipping))
            .add(BigInteger.valueOf(invoice.vat))
        if (expected != BigInteger.valueOf(invoice.total)) return null
        return sold to listed
    }
    private fun discounted(listed:BigInteger,percent:Int):BigInteger =
        listed.multiply(BigInteger.valueOf((100-percent).toLong()))
            .add(BigInteger.valueOf(50L)).divide(HUNDRED)

    private fun sameBasket(a: SatoriInvoice,b: SatoriInvoice):Boolean {
        fun basket(invoice:SatoriInvoice) = invoice.lines
            .groupBy { Pair(SatoriData.normalized(it.code.ifBlank { it.description }),
                SatoriData.normalized(it.unit)) }
            .mapValues { entry->entry.value.sumOf { it.quantity.toLong() } }
        return a.lines.isNotEmpty() && b.lines.isNotEmpty() && basket(a)==basket(b)
    }

    fun calculate(invoices: List<SatoriInvoice>): List<AccountingProMargin45Row> {
        val references=invoices.filter { it.isInternalCollaboratorBill }
        val checkedIdentity=AccountingProReadOnly.invoiceRows(invoices)
            .associate { it.invoice.id to it.identityReliable }
        return invoices.filterNot { it.isExcluded }.map { invoice ->
            val untrusted=checkedIdentity[invoice.id] != true
            val pair=goods(invoice)
            var warning:String?=null
            if(untrusted) warning="ID/số hóa đơn thiếu hoặc trùng."
            else if(pair==null) warning="Thiếu giá niêm yết, dòng hàng hoặc tổng bill không khớp."
            val cost=if(pair!=null) discounted(pair.second,SUPPLIER_DISCOUNT_PERCENT)
                else null
            val sale=pair?.first
            var commission=BigInteger.ZERO
            if(warning==null && (invoice.isLinkedPairBill ||
                    invoice.collaboratorId.isNotBlank() ||
                    invoice.pairDiscountPercent != null)) {
                if(invoice.isCustomerPairBill) {
                    val partner=references.filter { other ->
                        other.pairGroupId.isNotBlank() &&
                            other.pairGroupId==invoice.pairGroupId &&
                            other.pairInvoiceNo==invoice.number &&
                            invoice.pairInvoiceNo==other.number &&
                            invoice.collaboratorId.isNotBlank() &&
                            invoice.collaboratorId==other.collaboratorId &&
                            other.address.isNotBlank() &&
                            SatoriData.normalized(invoice.address)==SatoriData.normalized(other.address) &&
                            sameBasket(invoice,other)
                    }
                    val other=partner.singleOrNull()
                    val partnerSold=other?.let { goods(it)?.first }
                    if(other==null || partnerSold==null || sale==null || partnerSold>sale)
                        warning="Dữ liệu CTV cũ chưa đối chiếu được hoa hồng."
                    else commission=sale.subtract(partnerSold)
                } else if(invoice.pairRole.isBlank() &&
                    invoice.collaboratorId.isNotBlank() &&
                    invoice.pairDiscountPercent != null) {
                    val percent=invoice.pairDiscountPercent
                    if(percent==null || !percent.isFinite() || percent<0.0 ||
                        percent>100.0 || sale==null || pair==null)
                        warning="Chiết khấu CTV không hợp lệ."
                    else {
                        val cents=Math.round(percent*100)
                        val ctvBase=pair.second.multiply(BigInteger.valueOf(10000-cents))
                            .add(BigInteger.valueOf(5000L))
                            .divide(BigInteger.valueOf(10000L))
                        if(ctvBase>sale) warning="Giá CTV cao hơn giá khách, cần rà soát."
                        else commission=sale.subtract(ctvBase)
                    }
                } else warning="Thiếu chính sách hoa hồng CTV đã xác minh."
            }
            val finalMargin=if(warning==null && sale!=null && cost!=null)
                checked(sale.subtract(cost).subtract(commission)) else null
            if(warning==null && finalMargin==null)warning="Số tiền vượt giới hạn an toàn."
            AccountingProMargin45Row(invoice,
                sale?.let(::checked),cost?.let(::checked),
                if(warning==null) checked(commission) else null,
                finalMargin,warning)
        }
    }

    fun summarize(rows: List<AccountingProMargin45Row>,
        period:AccountingProMargin45Period):AccountingProMargin45Summary {
        val eligible=rows.filter { period.includes(it.invoice) }
        val known=eligible.mapNotNull { it.estimatedOwnerMarginVnd }
        var total=BigInteger.ZERO
        for(value in known)total=total.add(BigInteger.valueOf(value))
        val amount=if(known.isEmpty()) null else checked(total)
        val missing=eligible.count { it.estimatedOwnerMarginVnd==null }
        return AccountingProMargin45Summary(period,eligible.size,known.size,
            missing,rows.count { !it.invoice.hasValidDate },
            amount,missing==0 && amount!=null)
    }
}
