import unittest
from provision_release_signing import allow_provisioning, SECRET_NAMES


class StableKeyProtectionTest(unittest.TestCase):
    pin = 'ab' * 32

    def test_first_setup_without_any_signing_config(self):
        allow_provisioning('', set(), self.pin)

    def test_same_key_can_finish_interrupted_secret_upload(self):
        allow_provisioning(self.pin, {next(iter(SECRET_NAMES))}, self.pin)

    def test_existing_pin_compares_case_insensitively(self):
        allow_provisioning(self.pin.upper(), SECRET_NAMES, self.pin)

    def test_different_key_cannot_replace_existing_identity(self):
        with self.assertRaises(RuntimeError):
            allow_provisioning('cd' * 32, SECRET_NAMES, self.pin)

    def test_existing_signing_secrets_without_pin_require_manual_recovery(self):
        for name in SECRET_NAMES:
            with self.assertRaises(RuntimeError):
                allow_provisioning('', {name}, self.pin)

    def test_unrelated_secrets_do_not_get_replaced(self):
        allow_provisioning('', {'ANOTHER_PROJECT_SECRET'}, self.pin)


if __name__ == '__main__':
    unittest.main()
