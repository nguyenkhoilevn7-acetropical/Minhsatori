"""Foldable/regular Android layout contract; fake offline-only source assertions."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = (ROOT / "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")
MANIFEST = (ROOT / "app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
WORKFLOW = (ROOT.parent / ".github/workflows/android-native-ui-screenshot.yml").read_text(encoding="utf-8")


class FoldableMoneyMindContract(unittest.TestCase):
    def test_resize_live_preserves_accounting_session_and_tabs(self):
        self.assertIn('android:configChanges="screenSize|smallestScreenSize|orientation"', MANIFEST)
        self.assertIn('override fun onConfigurationChanged(newConfig: Configuration)', NATIVE)
        method = NATIVE.split('override fun onConfigurationChanged(newConfig: Configuration)', 1)[1].split(
            'private fun render()', 1)[0]
        self.assertIn('super.onConfigurationChanged(newConfig)', method)
        self.assertIn('if (previousScrollView != null) render()', method)
        self.assertNotIn('accessToken = null', method)
        self.assertNotIn('snapshot = null', method)

    def test_unfolded_canvas_is_capped_and_centered(self):
        self.assertIn('resources.configuration.screenWidthDp', NATIVE)
        self.assertIn('if (widthDp >= 600) dp(minOf(680, widthDp - 32)) else -1', NATIVE)
        self.assertIn('adaptiveShellWidth(), -1, Gravity.CENTER_HORIZONTAL', NATIVE)
        self.assertIn('resources.configuration.screenWidthDp - 36', NATIVE)

    def test_drawer_and_tabs_animate_only_when_allowed(self):
        self.assertIn('ValueAnimator.areAnimatorsEnabled()', NATIVE)
        self.assertIn('if (tabChanged && motionEnabled())', NATIVE)
        self.assertIn('.setInterpolator(DecelerateInterpolator())', NATIVE)
        self.assertIn('if (!motionEnabled()) {', NATIVE)

    def test_emulator_captures_bar_phone_and_both_fold_states(self):
        for marker in ('minhsatori-native-home.png',
                       'minhsatori-fold-open.png',
                       'minhsatori-fold-closed.png',
                       'adb shell wm size 1812x2176',
                       'adb shell wm size 904x2316',
                       'adb shell wm size reset',
                       'adb shell wm density reset'):
            self.assertIn(marker, WORKFLOW)


if __name__ == "__main__":
    unittest.main()
