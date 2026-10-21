import unittest
from verify_release import validate


class ReleaseIdentityTest(unittest.TestCase):
    badge = "package: name='vn.minhsatori.app' versionCode='12' versionName='0.3.5' platformBuildVersionName='15'\n"
    digest = "ab" * 32
    certs = ("Signer #1 certificate DN: CN=Minh Satori Release\n"
             "Signer #1 certificate SHA-256 digest: " + digest + "\n"
             "Signer #1 certificate SHA-1 digest: " + "cd" * 20 + "\n")

    def test_stable_signer_and_public_oauth_sha1(self):
        report = validate(self.badge, self.certs, self.digest.upper())
        self.assertEqual(report["certificateSha1"], "cd" * 20)

    def test_wrong_signer(self):
        with self.assertRaises(ValueError):
            validate(self.badge, self.certs, "ef" * 32)

    def test_missing_pin(self):
        with self.assertRaises(ValueError):
            validate(self.badge, self.certs, "")

    def test_debuggable(self):
        with self.assertRaises(ValueError):
            validate(self.badge + "application-debuggable\n", self.certs, self.digest)

    def test_debug_key_even_when_pinned(self):
        with self.assertRaises(ValueError):
            validate(self.badge, self.certs.replace("Minh Satori Release", "Android Debug"), self.digest)

    def test_wrong_version_or_package(self):
        for value in [self.badge.replace("0.3.5", "0.3.4"), self.badge.replace("vn.minhsatori.app", "vn.other.app")]:
            with self.assertRaises(ValueError):
                validate(value, self.certs, self.digest)

    def test_unsigned(self):
        with self.assertRaises(ValueError):
            validate(self.badge, "", self.digest)

    def test_multiple_signers(self):
        with self.assertRaises(ValueError):
            validate(self.badge, self.certs + self.certs.replace("Signer #1", "Signer #2"), self.digest)

    def test_missing_oauth_fingerprint(self):
        with self.assertRaises(ValueError):
            validate(self.badge, self.certs.split("Signer #1 certificate SHA-1")[0], self.digest)


if __name__ == "__main__":
    unittest.main()
