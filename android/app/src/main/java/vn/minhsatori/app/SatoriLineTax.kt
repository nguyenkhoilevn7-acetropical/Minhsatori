package vn.minhsatori.app

/** Explicit line-tax choice only; an empty rate never guesses a default. */
internal object SatoriLineTax {
    fun amount(goods: Long, rate: String, exempt: Boolean): Long =
        if (exempt) 0L else SatoriPercentCharges.amount(goods, rate)
}
