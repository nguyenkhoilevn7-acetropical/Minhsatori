package vn.minhsatori.app

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.time.YearMonth

/**
 * OWNER'S NEGOTIATED COMPANY DISCOUNT: 45% OFF the line's stored list price.
 * Cost per unit = roundHalfUp(listPrice * 55 / 100) VND.
 *
 * This is an estimated MERCHANDISE MARGIN based on negotiated supplier rate,
 * NOT bank-realized income, net profit or evidence of the supplier's actual
 * settlement invoice. It excludes VAT and shipping revenue, and does not
 * quietly subtract an unverified CTV commission or operating expenses.
 *
 * Uses only the original canonical snapshot. Never creates/modifies orders.
 */
object AccountingProProfit45 {
    const val COMPANY_DISCOUNT_PERCENT = 45
    private val FIFTY_FIVE = BigDecimal.valueOf(55)
    private val HUNDRED = BigDecimal.valueOf(100)

    data class InvoiceMargin(
        val invoice: SatoriInvoice,
        val date: LocalDate?,
        val merchandiseRevenueVnd: Long?,
        val companyCostEstimateVnd: Long?,
        val merchandiseMarginBeforeCtvVnd: Long?,
        val verifiedLegacyCtvCommissionVnd: Long?,
        val marginAfterVerifiedLegacyCtvVnd: Long?,
        val warning: String?
    ) {
        val canAggregate: Boolean get() =
            merchandiseRevenueVnd != null && companyCostEstimateVnd != null &&
                merchandiseMarginBeforeCtvVnd != null && warning == null
    }

    data class MarginTotals(
        val start: LocalDate,
        val end: LocalDate,
        val invoiceCount: Int,
        val calculatedCount: Int,
        val skippedCount: Int,
        val saleMerchandiseRevenueVnd: Long?,
        val purchaseCostEstimateVnd: Long?,
        val grossMerchandiseMarginVnd: Long?,
        val afterCtvMarginVnd: Long?,
        val ctvUnverifiedCount: Int,
        val records: List<InvoiceMargin>
    )

    /** All date filters are inclusive and use invoice issue date in Vietnam. */
    fun date(invoice: SatoriInvoice): LocalDate? =
        invoice.sortDate.takeIf { it.length == 8 && it != "00000000" }
            ?.let { raw ->
                runCatching {
                    LocalDate.of(raw.take(4).toInt(), raw.substring(4, 6).toInt(),
                        raw.substring(6, 8).toInt())
                }.getOrNull()
            }

    fun day(day: LocalDate): Pair<LocalDate,LocalDate> = day to day
    fun month(month: YearMonth): Pair<LocalDate,LocalDate> =
        month.atDay(1) to month.atEndOfMonth()
    fun year(year: Int): Pair<LocalDate,LocalDate> =
        LocalDate.of(year, 1, 1) to LocalDate.of(year, 12, 31)

    private fun safeLong(value: BigDecimal): Long =
        value.longValueExact()

    /** Compute the cost at 55% LIST PRICE for one unit, then multiply quantity. */
    fun unitCompanyCost(listPriceVnd: Long): Long {
        require(listPriceVnd > 0L) { "Thiếu giá niêm yết gốc." }
        return safeLong(BigDecimal.valueOf(listPriceVnd)
            .multiply(FIFTY_FIVE)
            .divide(HUNDRED, 0, RoundingMode.HALF_UP))
    }

    private fun merchandiseTotal(lines: List<SatoriLine>, listPrice: Boolean): Long {
        require(lines.isNotEmpty()) { "Hóa đơn thiếu chi tiết sản phẩm." }
        var sum = 0L
        for (line in lines) {
            require(line.quantity > 0 && line.description.isNotBlank()) {
                "Dòng hàng thiếu sản phẩm hoặc số lượng."
            }
            val unit = if (listPrice) line.listPrice else line.unitPrice
            require(unit >= 0L && (!listPrice || unit > 0L)) {
                "Thiếu giá niêm yết hoặc đơn giá bán hợp lệ."
            }
            sum = Math.addExact(sum, Math.multiplyExact(line.quantity.toLong(), unit))
        }
        return sum
    }

    private fun estimatedCost(lines: List<SatoriLine>): Long {
        var cost = 0L
        for (line in lines) {
            require(line.quantity > 0 && line.description.isNotBlank()) {
                "Dòng hàng thiếu sản phẩm hoặc số lượng."
            }
            cost = Math.addExact(cost, Math.multiplyExact(
                unitCompanyCost(line.listPrice), line.quantity.toLong()))
        }
        return cost
    }

    private fun verifiedPairCommission(
        customerBill: SatoriInvoice, allInvoices: List<SatoriInvoice>
    ): Long? {
        if (!customerBill.isCustomerPairBill ||
            customerBill.pairGroupId.isBlank() ||
            customerBill.collaboratorId.isBlank()) return null

        val candidates = allInvoices.filter { row ->
            row.isInternalCollaboratorBill && !row.isTest &&
                row.status != "Đã hủy" && row.status != "Không Tính" &&
                row.pairGroupId == customerBill.pairGroupId &&
                row.pairInvoiceNo == customerBill.number &&
                customerBill.pairInvoiceNo == row.number &&
                row.collaboratorId == customerBill.collaboratorId &&
                SatoriData.normalized(row.address) ==
                    SatoriData.normalized(customerBill.address) &&
                row.lines.size == customerBill.lines.size &&
                row.lines.zip(customerBill.lines).all { (a, b) ->
                    a.quantity == b.quantity &&
                    SatoriData.normalized(a.code.ifBlank { a.description }) ==
                        SatoriData.normalized(b.code.ifBlank { b.description }) &&
                    SatoriData.normalized(a.unit) == SatoriData.normalized(b.unit)
                }
        }
        if (candidates.size != 1) return null
        return try {
            val high = merchandiseTotal(customerBill.lines, false)
            val low = merchandiseTotal(candidates.single().lines, false)
            if (low >= high) null else Math.subtractExact(high, low)
        } catch (_: RuntimeException) { null }
    }

    fun invoice(
        bill: SatoriInvoice,
        allInvoices: List<SatoriInvoice>,
        identityReliable: Boolean
    ): InvoiceMargin {
        val d = date(bill)
        val ctvLinked = bill.collaboratorId.isNotBlank() ||
            bill.isLinkedPairBill || bill.pairDiscountPercent != null
        val warning: String?
        val revenue: Long?
        val purchase: Long?
        val margin: Long?
        try {
            require(!bill.isExcluded) { "Hóa đơn không tính doanh thu." }
            require(identityReliable) { "ID hoặc số hóa đơn thiếu/trùng." }
            require(d != null) { "Ngày hóa đơn không hợp lệ." }
            require(bill.shipping >= 0L && bill.vat >= 0L) {
                "Phí giao hoặc VAT không hợp lệ."
            }
            val goods = merchandiseTotal(bill.lines, false)
            val expected = Math.addExact(Math.addExact(goods, bill.shipping), bill.vat)
            require(expected == bill.total) {
                "Tiền hàng không khớp tổng bill (sau VAT/phí giao)."
            }
            val cost = estimatedCost(bill.lines)
            val profit = Math.subtractExact(goods, cost)
            revenue = goods
            purchase = cost
            margin = profit
            warning = null
        } catch (e: RuntimeException) {
            return InvoiceMargin(bill, d, null, null, null, null, null,
                e.message ?: "Hóa đơn chưa đủ dữ liệu định giá.")
        }
        val commission = if (ctvLinked)
            verifiedPairCommission(bill, allInvoices) else 0L
        val after = if (commission != null) {
            try { Math.subtractExact(margin!!, commission) }
            catch (_: ArithmeticException) { null }
        } else null
        return InvoiceMargin(bill, d, revenue, purchase, margin,
            commission, after, warning)
    }

    fun summarize(
        invoices: List<SatoriInvoice>, start: LocalDate, end: LocalDate
    ): MarginTotals {
        require(!start.isAfter(end)) { "Ngày bắt đầu sau ngày kết thúc." }
        val valid = AccountingProReadOnly.invoiceRows(invoices)
        val all = valid.filter { row ->
            val d = date(row.invoice)
            d != null && !d.isBefore(start) && !d.isAfter(end)
        }.map { row -> invoice(row.invoice, invoices, row.identityReliable) }
        val calculated = all.filter { it.canAggregate }
        val revenue = checkedSum(calculated.mapNotNull { it.merchandiseRevenueVnd })
        val cost = checkedSum(calculated.mapNotNull { it.companyCostEstimateVnd })
        val margin = checkedSum(calculated.mapNotNull { it.merchandiseMarginBeforeCtvVnd })
        val ctvUnverified = calculated.count { it.marginAfterVerifiedLegacyCtvVnd == null }
        val after = if (ctvUnverified == 0 && calculated.size == all.size)
            checkedSum(calculated.mapNotNull { it.marginAfterVerifiedLegacyCtvVnd })
        else null
        return MarginTotals(start, end, all.size, calculated.size,
            all.size - calculated.size, revenue, cost, margin,
            after, ctvUnverified, all)
    }

    private fun checkedSum(values: List<Long>): Long? = try {
        values.fold(0L) { a, b -> Math.addExact(a, b) }
    } catch (_: ArithmeticException) { null }
}
