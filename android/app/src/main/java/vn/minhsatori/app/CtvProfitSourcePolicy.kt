package vn.minhsatori.app

/**
 * Owner-only, read-only profit source reconciliation.
 *
 * An older Apps Script Mobile API may return the verified live invoices but
 * omit the satori_collaborators_v1 key. Do not treat this missing financial
 * policy as "no CTV" and accidentally present a gross margin as net profit.
 *
 * Direct Drive recovery is allowed only from the same production ledger
 * revision and byte-equivalent parsed invoice/catalogue records. No writes.
 */
internal object CtvProfitSourcePolicy {
    fun recover(api: SatoriSnapshot, drive: SatoriSnapshot): SatoriSnapshot? {
        if (api.collaboratorRegistryLoaded && api.collaborators.isNotEmpty()) return api
        if (!drive.collaboratorRegistryLoaded || drive.collaborators.isEmpty() ||
            api.revision != drive.revision ||
            api.invoices != drive.invoices || api.products != drive.products) return null
        return api.copy(collaborators = drive.collaborators,
            collaboratorRegistryLoaded = true)
    }

    fun profitRows(snapshot: SatoriSnapshot): List<AccountingProMargin45Row> {
        val rows = AccountingProMargin45.calculate(
            snapshot.invoices, snapshot.collaborators)
        if (snapshot.collaboratorRegistryLoaded && snapshot.collaborators.isNotEmpty())
            return rows
        return rows.map { row ->
            row.copy(estimatedCtvCommissionVnd = null,
                estimatedOwnerMarginVnd = null,
                reason = "Nguồn đồng bộ thiếu hồ sơ CTV; không được hiển thị lãi gộp như lợi nhuận.")
        }
    }
}
