"""Static contract: Native owner invoice edits take percentages but server still receives VND."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDITOR = ROOT / "app/src/main/java/vn/minhsatori/app/NativeOrderEditor.kt"
MATH = ROOT / "app/src/main/java/vn/minhsatori/app/SatoriPercentCharges.kt"

class InvoiceEditPercentContract(unittest.TestCase):
    def test_edit_has_percentage_fields_but_new_order_still_uses_vnd(self):
        code = EDITOR.read_text(encoding="utf-8")
        self.assertIn('ship=input(a,page,"Shipping (%)"', code)
        self.assertIn('tax=input(a,page,"VAT (%)"', code)
        self.assertIn('ship=input(a,page,"Phí giao hàng (đ)","0",numeric=true)', code)
        self.assertIn('tax=input(a,page,"VAT (đ)","0",numeric=true)', code)
        self.assertIn("shippingPercentModified=true", code)
        self.assertIn("vatPercentModified=true", code)

    def test_live_preview_and_server_payload_use_same_calculated_amounts(self):
        code = EDITOR.read_text(encoding="utf-8")
        self.assertIn('val (shipping,vat)=charges(goods)', code)
        self.assertIn('SatoriOrderValidation.sum(goods,shipping,vat)', code)
        self.assertIn('.put("shippingAmount",shipping).put("vatAmount",vat)', code)
        self.assertIn('.put("total",sum)', code)
        self.assertNotIn('.put("shippingPercent",', code)
        self.assertNotIn('.put("vatPercent",', code)
        self.assertIn('val sum=SatoriOrderValidation.sum(goods,shipping,vat)', code)

    def test_no_payment_or_production_ledger_mutation(self):
        source = MATH.read_text(encoding="utf-8")
        self.assertIn("BigDecimal", source)
        self.assertIn("RoundingMode.HALF_UP", source)
        self.assertIn("if (!percentModified && originalGoods == goods", source)
        self.assertNotIn("MobileApiClient", source)
        self.assertNotIn("orders.update", source)

if __name__ == "__main__":
    unittest.main()
