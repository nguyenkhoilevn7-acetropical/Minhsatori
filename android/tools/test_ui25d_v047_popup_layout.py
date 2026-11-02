"""UI25D is a visual migration; do not change invoice writes or owner API authorization."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
KOTLIN = ROOT / "app/src/main/java/vn/minhsatori/app"
MAIN = (KOTLIN / "NativeMainActivity.kt").read_text(encoding="utf-8")
EDITOR = (KOTLIN / "NativeOrderEditor.kt").read_text(encoding="utf-8")
THEME = (ROOT / "app/src/main/res/values/styles.xml").read_text(encoding="utf-8")
COLORS = (ROOT / "app/src/main/res/values/colors.xml").read_text(encoding="utf-8")
DIALOG = (ROOT / "app/src/main/res/drawable/satori_ui25d_dialog_bg.xml").read_text(encoding="utf-8")

class ApprovedUi25dSurface(unittest.TestCase):
    def test_different_screen_layouts_are_real_not_color_only(self):
        for token in (
            "renderUi25dHome(content, data)",
            "renderUi25dSectionIntro(content, pages[activeTab])",
            'kpi("Công nợ phải thu"',
            "val chipScroll = android.widget.HorizontalScrollView(this)",
            "val chips = mutableListOf<TextView>()",
            'label(countSummary, "TỔNG HÓA ĐƠN"',
            "styleUi25dInvoiceCard(list)",
            "styleUi25dInvoiceCard(parent)",
            "renderUi25dOrderChoices(parent, canWrite)",
            "renderUi25dOrderChoices(parent, false)",
            "FrameLayout.LayoutParams(drawerWidth, -1, Gravity.END)"
        ):
            with self.subTest(token=token): self.assertIn(token,MAIN)

    def test_native_order_modal_is_rounded_and_preserves_authorized_submit(self):
        for token in (
            "cornerRadius=dp(a,21).toFloat()",
            "cornerRadius = dp(a,20).toFloat()",
            "SatoriUiTheme.deep(a)",
            "SatoriUiTheme.raised(a)",
            'val requestId=UUID.randomUUID()',
            'val submittedPayload:',
            'submit:(',
            "SatoriOrderValidation.sum(goods,shipping,vat)"
        ):
            with self.subTest(token=token): self.assertIn(token,EDITOR)

    def test_all_native_alerts_have_light_rounded_surface(self):
        self.assertIn("SatoriUi25dDialogTheme",THEME)
        self.assertIn("@drawable/satori_ui25d_dialog_bg",THEME)
        self.assertIn('<corners android:radius="22dp" />',DIALOG)
        self.assertIn("#008E8C",COLORS)
        self.assertIn('android:windowLightStatusBar">false',THEME)

    def test_original_owner_payment_and_notification_paths_still_resolved(self):
        for token in (
            'confirmInvoicePayment(', 'executeWrite(', 'confirmSoftDelete(',
            'requestInvoiceEdit(', 'NativeInvoicePdf.preview',
            'V2RegistrationAlerts.pendingCount(this)',
            'openPendingNotificationInvoiceIfReady()'
        ):
            with self.subTest(token=token): self.assertIn(token,MAIN)

if __name__ == "__main__":
    unittest.main()
