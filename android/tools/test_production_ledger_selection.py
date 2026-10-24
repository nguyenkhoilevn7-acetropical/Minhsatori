"""Guard against displaying the legacy three-invoice sandbox as production."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "app/src/main/java/vn/minhsatori/app"
MAIN = (ROOT / "NativeMainActivity.kt").read_text(encoding="utf-8")
API = (ROOT / "MobileApiClient.kt").read_text(encoding="utf-8")
DRIVE = (ROOT / "DriveReadClient.kt").read_text(encoding="utf-8")
POLICY = (ROOT / "ProductionLedgerPolicy.kt").read_text(encoding="utf-8")


class OwnerLedgerSelectionTest(unittest.TestCase):
    def test_rejects_revision_older_than_verified_owner_state(self):
        self.assertIn("VERIFIED_REVISION_FLOOR: Long = 133L", POLICY)
        self.assertIn("snapshot.revision < VERIFIED_REVISION_FLOOR", POLICY)

    def test_three_invoice_demo_rejected_even_without_test_flag(self):
        self.assertIn("snapshot.invoices.size < SUSPICIOUSLY_SMALL_LEDGER", POLICY)
        self.assertIn("snapshot.invoices.all { it.isTest }", POLICY)

    def test_all_three_possible_read_paths_fail_closed(self):
        self.assertIn("ProductionLedgerPolicy.rejection(parsed)", API)
        self.assertIn("ProductionLedgerPolicy.rejection(parsed)", DRIVE)
        self.assertIn("ProductionLedgerPolicy.rejection(parsed)", MAIN)

    def test_disallows_reappearing_old_demo_after_network_errors(self):
        self.assertIn("ProductionLedgerPolicy.rejection(old) != null", MAIN)
        self.assertIn("snapshot = null", MAIN)
        self.assertIn("allowedActions = emptySet()", MAIN)


if __name__ == "__main__":
    unittest.main()
