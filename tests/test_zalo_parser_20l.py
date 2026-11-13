import unittest
from zalo_parser import parse_zalo_message


class Discontinued20LTest(unittest.TestCase):
    def test_20l_is_rejected_not_rewritten_as_19l(self):
        for name in ("20L", "20 lít", "20-lit", "20 l"):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "20L đã ngừng bán"):
                    parse_zalo_message("Giao 1 bình Satori " + name)

    def test_19l_is_still_available(self):
        order = parse_zalo_message("Giao 1 bình Satori 19L")
        self.assertEqual(order["product"], "Bình Satori 19L")

    def test_500ml_still_available(self):
        order = parse_zalo_message("Giao 2 thùng Satori 500ml")
        self.assertEqual(order["product"], "Suối Satori 500ml")


if __name__ == "__main__":
    unittest.main()
