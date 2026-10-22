import unittest
import contextlib
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
from unittest.mock import patch
import provision_release_signing as helper
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


@unittest.skipUnless(shutil.which('keytool'), 'Needs JDK for offline signing-helper integration')
class OfflineProvisioningIntegrationTest(unittest.TestCase):
    def exercise(self, interrupt):
        remote = {'pin': '', 'secrets': {}}
        fail_once = [interrupt]

        def fake_github(gh, *args, data=None, optional=False):
            if args[:2] == ('auth', 'status'):
                return 'authenticated-test-owner'
            if args[:2] == ('api', 'user'):
                return helper.REPO.split('/')[0]
            if args[:2] == ('variable', 'list'):
                return json.dumps([{'name': helper.PIN, 'value': remote['pin']}] if remote['pin'] else [])
            if args[:2] == ('variable', 'set'):
                remote['pin'] = data.decode()
                return ''
            if args[:2] == ('variable', 'get'):
                return remote['pin']
            if args[:2] == ('secret', 'list'):
                return json.dumps([{'name': name} for name in remote['secrets']])
            if args[:2] == ('secret', 'set'):
                remote['secrets'][args[2]] = data
                if fail_once[0]:
                    fail_once[0] = False
                    raise RuntimeError('Simulated interrupted upload after first secret')
                return ''
            raise AssertionError('Unexpected GitHub operation: ' + str(args))

        with tempfile.TemporaryDirectory() as temp, patch.object(helper, 'install_cli', return_value='offline-test-gh'), \
                patch.object(helper, 'github', side_effect=fake_github), contextlib.redirect_stdout(io.StringIO()) as output:
            directory = Path(temp) / 'private-signing'
            if interrupt:
                with self.assertRaises(RuntimeError):
                    helper.provision(directory)
                self.assertTrue(remote['pin'])
            else:
                helper.provision(directory)
            first = hashlib.sha256((directory / 'minhsatori-release.jks').read_bytes()).hexdigest()
            helper.provision(directory)
            self.assertEqual(first, hashlib.sha256((directory / 'minhsatori-release.jks').read_bytes()).hexdigest())
            self.assertEqual(SECRET_NAMES, set(remote['secrets']))
            credentials = json.loads((directory / 'signing-credentials.json').read_text())
            self.assertNotIn(credentials['password'], output.getvalue())
            self.assertNotIn(remote['secrets']['SATORI_ANDROID_KEYSTORE_BASE64'].decode(), output.getvalue())
            self.assertEqual(remote['pin'], json.loads((directory / 'public-certificate.json').read_text())['certificateSha256'])
            self.assertEqual(0, directory.stat().st_mode & 0o077)
            self.assertEqual(0, (directory / 'minhsatori-release.jks').stat().st_mode & 0o077)

    def test_real_local_key_and_mock_secret_config_are_stable_on_rerun(self):
        self.exercise(False)

    def test_interrupted_upload_resumes_without_replacing_signing_key(self):
        self.exercise(True)


if __name__ == '__main__':
    unittest.main()
