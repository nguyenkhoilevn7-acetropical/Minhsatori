"""Native owner header: hamburger right of settings, drawer opens and closes on right."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
GRADLE = (ROOT / "app/build.gradle.kts").read_text(encoding="utf-8")

class RightEdgeDrawerContract(unittest.TestCase):
    def test_header_order_keeps_logo_alone_on_left(self):
        header = SRC.split('val brand = LinearLayout(this).apply {', 1)[1].split('val pages = listOf("Tổng quan"', 1)[0]
        items = [
            "brand.addView(brandLogo",
            "brand.addView(brandText",
            "brand.addView(refreshButton",
            "brand.addView(bellButton",
            "brand.addView(options",
            "brand.addView(menuButton",
        ]
        indices = [header.index(item) for item in items]
        self.assertEqual(indices, sorted(indices), "Hamburger must be last, directly beside settings")
        self.assertEqual(header.count("brand.addView(menuButton"), 1)
        self.assertIn('contentDescription = "Mở menu tác vụ"', header)
        self.assertIn('setImageResource(R.drawable.satori_invoice_logo)', header)

    def test_drawer_enters_from_right_and_aligns_to_fold_canvas(self):
        drawer = SRC.split('// Preserve the drawer as the full advanced navigation inventory.', 1)[1]
        self.assertIn("FrameLayout.LayoutParams(drawerWidth, -1, Gravity.END)", drawer)
        self.assertIn("rightMargin = shellInset", drawer)
        self.assertNotIn("leftMargin = shellInset", drawer)
        self.assertEqual(drawer.count("drawerWidth.toFloat()"), 4)
        self.assertNotIn("-drawerWidth.toFloat()", drawer)
        self.assertIn("drawer.animate().translationX(0f).setDuration(245)", drawer)
        self.assertIn("drawer.animate().translationX(drawerWidth.toFloat())", drawer)
        self.assertIn("menuButton.setOnClickListener { showDrawer() }", drawer)
        self.assertIn("closeButton.setOnClickListener { dismissDrawer() }", drawer)
        self.assertIn("scrim.setOnClickListener { dismissDrawer() }", drawer)
        self.assertIn("if (!motionEnabled())", drawer)
        self.assertIn("dp((resources.configuration.screenWidthDp - 36).coerceAtLeast(225))", drawer)

    def test_non_destructive_samsung_upgrade(self):
        self.assertIn('applicationId = "vn.minhsatori.app"', GRADLE)
        self.assertIn('versionName = "0.4.18"', GRADLE)
        self.assertIn("versionCode = 35", GRADLE)

if __name__ == "__main__":
    unittest.main()
