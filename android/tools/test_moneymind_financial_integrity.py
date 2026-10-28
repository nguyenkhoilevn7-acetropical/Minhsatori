"""Fail closed if a visual-only MoneyMind PR changes core financial code.

Baseline is the existing reviewed feature/android-full-ui-parity-owner-preview branch.
This offline test neither touches the network nor executes any invoice write.
"""
from pathlib import Path
import struct
import unittest

SOURCE = (Path(__file__).resolve().parents[1] /
          "app/src/main/java/vn/minhsatori/app/NativeMainActivity.kt").read_text(encoding="utf-8")

# FNV-1a over UTF-16 code units of each protected native Kotlin method.
# Do not update these hashes merely to make a style/animation PR pass.
PROTECTED = {
    "confirmInvoicePayment": "7c1541e5",
    "requestInvoiceEdit": "6cedda93",
    "confirmSoftDelete": "6717c467",
    "executeWrite": "a513026e",
    "launchEditor": "a449a547",
    "recoverDriveAccessUsingOwnerApi": "4c0215f3",
}


def method_source(name: str) -> str:
    needle = "    private fun " + name + "("
    start = SOURCE.find(needle)
    if start < 0:
        raise AssertionError("Missing owner action: " + name)
    stop = SOURCE.find("\n    private fun ", start + len(needle))
    return SOURCE[start:] if stop < 0 else SOURCE[start:stop]


def fnv32(text: str) -> str:
    raw = text.encode("utf-16-le")
    h = 0x811C9DC5
    for (unit,) in struct.iter_unpack("<H", raw):
        h = ((h ^ unit) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


class VisualOnlyFinancialSafetyContract(unittest.TestCase):
    def test_protected_business_methods_are_byte_identical_to_reviewed_baseline(self):
        for name, expected in PROTECTED.items():
            with self.subTest(action=name):
                self.assertEqual(fnv32(method_source(name)), expected,
                    name + " changed: financial code requires separate security review")

    def test_four_payment_transitions_remain_independent(self):
        payment = method_source("confirmInvoicePayment")
        for action in ("payments.markCustomerPaid",
                       "payments.markCustomerUnpaid",
                       "payments.markSatoriPaid",
                       "payments.markSatoriUnpaid"):
            self.assertIn(action, payment)
        self.assertIn("expectedRevision", payment)
        self.assertIn("executeWrite(action, payload", payment)

    def test_unverified_writes_remain_sealed(self):
        write = method_source("executeWrite")
        self.assertIn("pendingWrite", write)
        self.assertIn("requestId", write)
        self.assertIn("canAction(action)", SOURCE)
        self.assertNotIn('putString("accessToken"', SOURCE)


if __name__ == "__main__":
    unittest.main()
