package vn.minhsatori.app

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog

/**
 * Shared native UI25D presentation theme. Never touches invoices, OAuth or mobile writes.
 * Preferences persist across cold launch and Samsung Fold transitions.
 */
internal object SatoriUiTheme {
    private const val STORE = "minh_satori_ui25d"
    private const val COLOR = "accent"
    private const val DEPTH = "raised"
    private const val DEFAULT = "#008E8C"
    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    fun accent(context: Context): Int {
        val saved = prefs(context).getString(COLOR, DEFAULT) ?: DEFAULT
        return try { Color.parseColor(saved) } catch (_: IllegalArgumentException) { Color.parseColor(DEFAULT) }
    }

    fun raised(context: Context): Boolean = prefs(context).getBoolean(DEPTH, true)

    private fun blend(left: Int, right: Int, weight: Float): Int =
        Color.rgb(
            (Color.red(left) * (1f - weight) + Color.red(right) * weight).toInt(),
            (Color.green(left) * (1f - weight) + Color.green(right) * weight).toInt(),
            (Color.blue(left) * (1f - weight) + Color.blue(right) * weight).toInt()
        )

    fun soft(context: Context) = blend(accent(context), Color.WHITE, .88f)
    fun lighter(context: Context) = blend(accent(context), Color.WHITE, .27f)
    fun deep(context: Context) = blend(accent(context), Color.rgb(5, 41, 54), .27f)
    // Distinct from Color.WHITE: NativeMainActivity.label maps legacy white to dark on cards.
    fun onAccent(context: Context): Int {
        val color = accent(context)
        val brightness = (.2126 * Color.red(color) + .7152 * Color.green(color) + .0722 * Color.blue(color))
        return if (brightness > 174) Color.rgb(21, 46, 60) else Color.rgb(249, 253, 253)
    }

    fun picker(activity: Activity, refresh: () -> Unit) {
        val current = prefs(activity)
        val options = arrayOf(
            "● Ngọc lam (Teal)", "● Xanh tím (Indigo)", "● San hô (Coral)",
            "🎨 Tự chọn mã màu", if (raised(activity)) "Đổi sang 2D" else "Đổi sang 2.5D"
        )
        AlertDialog.Builder(activity)
            .setTitle("Giao diện Minh Satori · 2.5D")
            .setItems(options) { _, which ->
                when (which) {
                    0, 1, 2 -> {
                        current.edit().putString(COLOR,
                            arrayOf("#008E8C", "#5266C8", "#C96370")[which]).apply()
                        refresh()
                    }
                    3 -> {
                        val input = EditText(activity).apply {
                            setSingleLine(true)
                            hint = "#008E8C"
                            setText(String.format("#%06X", 0xFFFFFF and accent(activity)))
                            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
                            setPadding(30, 16, 30, 16)
                        }
                        AlertDialog.Builder(activity)
                            .setTitle("Màu tùy chỉnh · #RRGGBB")
                            .setView(input)
                            .setPositiveButton("Áp dụng") { _, _ ->
                                val value = input.text.toString().trim()
                                if (Regex("^#[0-9a-fA-F]{6}$").matches(value)) {
                                    current.edit().putString(COLOR, value).apply()
                                    refresh()
                                } else {
                                    Toast.makeText(activity, "Mã màu phải có dạng #008E8C",
                                        Toast.LENGTH_LONG).show()
                                }
                            }
                            .setNegativeButton("Hủy", null)
                            .show()
                    }
                    4 -> {
                        current.edit().putBoolean(DEPTH, !raised(activity)).apply()
                        refresh()
                    }
                }
            }.setNegativeButton("Đóng", null).show()
    }
}
