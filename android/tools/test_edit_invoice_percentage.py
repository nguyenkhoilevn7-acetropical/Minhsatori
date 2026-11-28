"""Synthetic source contracts for optional native VAT modes and legacy PDF layout."""
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'app/src/main/java/vn/minhsatori/app'
class InvoiceEditPercentContract(unittest.TestCase):
    def test_legacy_mode_is_default_and_retains_original_bill_controls(self):
        code = (SOURCE / 'NativeOrderEditor.kt').read_text()
        self.assertIn('isChecked = editing?.vatMode == "per_line"', code)
        self.assertIn('tax=input(a,page,"VAT (%)"', code)
        self.assertIn('tax=input(a,page,"VAT (đ)","0",numeric=true)', code)
        self.assertIn('editing.vat,vatPercentModified)', code)
        self.assertNotIn('else "8"', code)
    def test_line_tax_requires_explicit_mode_and_exemption(self):
        code = (SOURCE / 'NativeOrderEditor.kt').read_text()
        self.assertIn('if(perLine.isChecked)', code)
        self.assertIn('.put("vatExempt",it.vatExempt.isChecked)', code)
        self.assertIn('if(row.vatExempt.isChecked) 0L', code)
        self.assertIn('vatRate.text.isBlank()', code)
    def test_pdf_legacy_path_uses_unmodified_description(self):
        code = (SOURCE / 'WebsiteInvoicePdf.kt').read_text()
        self.assertIn('if (invoice.vatMode == "per_line")', code)
        self.assertIn('else line.description', code)
        self.assertNotIn('legacyVatRate', code)
        self.assertIn('SatoriData.money(invoice.vat)', code)
    def test_models_retain_optional_snapshot_fields(self):
        code = (SOURCE / 'SatoriModels.kt').read_text()
        self.assertIn('val vatMode: String = "invoice"', code)
        self.assertIn('vatMode = string(x, "vatMode")', code)
        self.assertIn('vatExempt = row.optBoolean("vatExempt", false)', code)
if __name__ == '__main__': unittest.main()
