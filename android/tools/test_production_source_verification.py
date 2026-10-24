import pathlib
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
APP=ROOT/"app/src/main/java/vn/minhsatori/app"
API=(ROOT.parent/"api/AndroidOwnerMobileApi.gs").read_text(encoding="utf8")
M=(APP/"MobileApiClient.kt").read_text(encoding="utf8")
P=(APP/"LiveSyncPolicy.kt").read_text(encoding="utf8")
class ProductionSourceTests(unittest.TestCase):
 def test_sandbox_revision_rejected(self):
  self.assertIn("MIN_PRODUCTION_REVISION = 133L",P)
  self.assertIn("file != DriveReadClient.LIVE_FILE_ID",P)
  self.assertIn("kind != PRODUCTION_LEDGER_KIND",P)
 def test_snapshot_must_verify_source(self):
  self.assertIn("LiveSyncPolicy.validateMobileSnapshot(",M)
  self.assertIn("LiveSyncPolicy.mobileRevision(data)",M)
 def test_owner_api_includes_canonical_source(self):
  self.assertIn("function ledgerProof(s)",API)
  self.assertIn("var attestation=ledgerProof(s)",API)
  self.assertIn("ledgerFileId:attestation.ledgerFileId",API)
if __name__=="__main__":unittest.main()
