package vn.minhsatori.app

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable

/** Screen-only simulated optical glass. No blur of secure content, no data access. */
internal object SatoriLiquidGlass {
    private fun dp(context: Context, value: Int) =
        (value * context.resources.displayMetrics.density + .5f).toInt()

    val lightText = Color.rgb(244, 251, 255)
    val mutedText = Color.rgb(207, 230, 235)

    fun backdrop(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(Color.rgb(221, 239, 238), Color.rgb(243, 247, 249),
            Color.rgb(206, 226, 233))
    )

    fun glass(context: Context, radius: Int, selected: Boolean = false): LayerDrawable {
        val r = dp(context, radius).toFloat()
        val base = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (selected)
            intArrayOf(Color.argb(215, 100, 148, 159), Color.argb(230, 50, 81, 94),
                Color.argb(230, 78, 117, 129))
            else intArrayOf(Color.argb(246, 63, 91, 101), Color.argb(248, 24, 43, 53),
                Color.argb(245, 49, 76, 87))).apply {
            cornerRadius = r
            setStroke(dp(context, 1), Color.argb(210, 224, 253, 255))
        }
        val highlight = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(Color.argb(62, 255, 255, 255), Color.TRANSPARENT,
                Color.argb(29, 198, 242, 255))).apply {
            cornerRadius = (r - dp(context, 2)).coerceAtLeast(0f)
            setStroke(dp(context, 1), Color.argb(70, 239, 255, 255))
        }
        return LayerDrawable(arrayOf(base, highlight)).apply {
            val inset = dp(context, 2)
            setLayerInset(1, inset, inset, inset, inset)
        }
    }

    fun icon(context: Context, index: Int): GradientDrawable {
        val colors = when(index) {
            0 -> intArrayOf(0xFFFFC9A0.toInt(), 0xFFE2713D.toInt(), 0xFFB74925.toInt())
            1 -> intArrayOf(0xFFB6DFFF.toInt(), 0xFF4A83DD.toInt(), 0xFF2446A5.toInt())
            2 -> intArrayOf(0xFFD7C5FF.toInt(), 0xFF8C67D7.toInt(), 0xFF55329C.toInt())
            3 -> intArrayOf(0xFFFFDEA3.toInt(), 0xFFBC852D.toInt(), 0xFF8E551C.toInt())
            4 -> intArrayOf(0xFFA5F6D7.toInt(), 0xFF359F83.toInt(), 0xFF126859.toInt())
            else -> intArrayOf(0xFFB9DCE8.toInt(), 0xFF527F92.toInt(), 0xFF304D63.toInt())
        }
        return GradientDrawable(GradientDrawable.Orientation.TL_BR, colors).apply {
            cornerRadius = dp(context, 12).toFloat()
            setStroke(dp(context, 1), Color.argb(150, 255, 255, 255))
        }
    }

    fun paper(context: Context, radius: Int): GradientDrawable =
        GradientDrawable(GradientDrawable.Orientation.TL_BR,
            intArrayOf(0xFFFFFFFF.toInt(), 0xFFF0F8F8.toInt(), 0xFFEAF3F5.toInt())).apply {
            cornerRadius = dp(context, radius).toFloat()
            setStroke(dp(context, 1), Color.rgb(203, 225, 228))
        }
}
