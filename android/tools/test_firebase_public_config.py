"""The committed Firebase config must be public identifiers only and match the app."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROPS = (ROOT / "firebase-public.properties").read_text()
GRADLE = (ROOT / "app/build.gradle.kts").read_text()
WF = (ROOT.parent / ".github/workflows/android-release-apk.yml").read_text()


def values():
    out = {}
    for line in PROPS.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


class FirebasePublicConfig(unittest.TestCase):
    def test_only_three_public_identifiers(self):
        v = values()
        self.assertEqual(set(v), {"SATORI_FCM_APP_ID", "SATORI_FCM_API_KEY", "SATORI_FCM_PROJECT_ID"})
        self.assertRegex(v["SATORI_FCM_APP_ID"], r"^1:(\d+):android:[0-9a-f]+$")
        self.assertRegex(v["SATORI_FCM_API_KEY"], r"^AIza[0-9A-Za-z_-]{35}$")
        self.assertRegex(v["SATORI_FCM_PROJECT_ID"], r"^[a-z][a-z0-9-]{4,62}$")
        self.assertNotRegex(PROPS, r"(?i)private_key|BEGIN [A-Z ]*PRIVATE KEY|service_account|client_email")

    def test_gradle_reads_file_with_env_override(self):
        self.assertIn('rootProject.file("firebase-public.properties")', GRADLE)
        self.assertIn("System.getenv(name)?.takeIf { it.isNotBlank() }", GRADLE)
        self.assertIn('applicationId = "vn.minhsatori.app"', GRADLE)

    def test_release_gate_accepts_committed_public_config_only(self):
        self.assertIn("android/firebase-public.properties", WF)
        self.assertIn("server credential must never be committed", WF)
        self.assertIn('req.get("requiresFcm") is True', WF)


if __name__ == "__main__":
    unittest.main()
