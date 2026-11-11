"""Static contract: Native owner invoice edits take percentages but server still receives VND."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDITOR = ROOT / "app/src/main/java/vn/minhsatori/app/NativeOrderEditor.kt"
MATH = ROOT / "app/src/main/java/vn/minhsatori/app/SatoriPercentCharges.kt"

class InvoiceEditPercentContract(unittest.TestCase):
    def test_shipping_remains_invoice_level_and_vat_is_per_line(self):
        code = EDITOR.read_text(encoding="utf-8")
        self.assertIn('ship=input(a,page,"Shipping (%)"', code)
        self.assertIn('ship=input(a,page,"Phí giao hàng (đ)","0",numeric=true)', code)
        self.assertIn('val vatRate=input(a,card,"VAT dòng (%) · nhập 0 nếu không tính"', code)
        self.assertIn('old?.vatRate?.toString() ?: if(old!=null) legacyVatRate else "8"', code)
        self.assertIn('watcher(qty);watcher(price);watcher(vatRate);recalc()', code)
        self.assertIn("shippingPercentModified=true", code)
        self.assertNotIn('tax=input(a,page,"VAT (%)"', code)
        self.assertNotIn('tax=input(a,page,"VAT (đ)"', code)
        self.assertNotIn("vatPercentModified", code)

    def test_line_tax_is_saved_with_each_item_and_bill_total_is_the_sum(self):
        code = EDITOR.read_text(encoding="utf-8")
        self.assertIn('.put("vatRate",vatRate).put("vatAmount",lineVat)', code)
        self.assertIn('val vat=SatoriPercentCharges.amount(subtotal,row.vatRate.text.toString())', code)
        self.assertIn('val vat=totalVat()', code)
        self.assertIn('else "8"', code)
        self.assertIn('VAT theo từng dòng:', code)

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
