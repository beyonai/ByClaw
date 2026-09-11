from __future__ import annotations
import json, os, sys, tempfile, unittest
from pathlib import Path
SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from _support import account, write_projection
from mail_runtime.config import AccountProjectionReader
from mail_runtime.models import ErrorCode, MailRuntimeError

class AccountProjectionReaderTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(); self.root = Path(self.tempdir.name).resolve() / "auth"
        self.root.mkdir(mode=0o700); self.reader = AccountProjectionReader(self.root)
    def tearDown(self): self.tempdir.cleanup()
    def assert_error(self, code):
        with self.assertRaises(MailRuntimeError) as raised: self.reader.read()
        self.assertEqual(code, raised.exception.code)
    def write_raw(self, filename, payload, mode=0o600):
        path = self.root / filename; path.write_text(json.dumps(payload), encoding="utf-8"); os.chmod(path, mode); return path
    def test_zero_one_and_multiple_connector_files(self):
        self.assert_error(ErrorCode.AUTH_REQUIRED)
        write_projection(self.root / "qq-mail.json", [account("qq-1", "qq")])
        self.assertEqual(["qq-1"], [item.account_id for item in self.reader.read()])
        write_projection(self.root / "gmail-mail.json", [account("gmail-1", "gmail")])
        self.assertEqual({"qq-1", "gmail-1"}, {item.account_id for item in self.reader.read()})
    def test_never_reads_aggregate_or_unknown_files(self):
        self.write_raw("accounts.json", {"schemaVersion": 1, "accounts": [account()]}, 0o000)
        self.write_raw("attacker-mail.json", {"secret": "ignored"}, 0o000)
        self.assert_error(ErrorCode.AUTH_REQUIRED)
    def test_rejects_schema_filename_connector_provider_and_extra_root_fields(self):
        cases = ({"schemaVersion": 1, "connectorCode": "qq-mail", "account": account()},
                 {"schemaVersion": 2, "connectorCode": "gmail-mail", "account": account()},
                 {"schemaVersion": 2, "connectorCode": "qq-mail", "account": account(provider="gmail")},
                 {"schemaVersion": 2, "connectorCode": "qq-mail", "account": account(), "extra": True})
        for payload in cases:
            with self.subTest(payload=payload):
                path = self.write_raw("qq-mail.json", payload); self.assert_error(ErrorCode.INVALID_REQUEST); path.unlink()
    def test_rejects_malformed_or_insecure_recognized_file(self):
        path = self.root / "qq-mail.json"; path.write_text("{", encoding="utf-8"); os.chmod(path, 0o600)
        self.assert_error(ErrorCode.INVALID_REQUEST)
        path.write_text(json.dumps({"schemaVersion": 2}), encoding="utf-8"); os.chmod(path, 0o644)
        self.assert_error(ErrorCode.INVALID_REQUEST)
    def test_rejects_duplicate_ids_across_files_and_default_field(self):
        write_projection(self.root / "qq-mail.json", [account("same", "qq")]); write_projection(self.root / "gmail-mail.json", [account("same", "gmail")])
        self.assert_error(ErrorCode.INVALID_REQUEST); (self.root / "gmail-mail.json").unlink()
        invalid = account(); invalid["default"] = True
        self.write_raw("qq-mail.json", {"schemaVersion": 2, "connectorCode": "qq-mail", "account": invalid})
        self.assert_error(ErrorCode.INVALID_REQUEST)
    def test_backend_contract_fixtures(self):
        for fixture in (Path(__file__).parent / "fixtures").glob("*-mail.json"):
            self.write_raw(fixture.name, json.loads(fixture.read_text(encoding="utf-8")))
        self.assertEqual({"qq", "netease-163", "gmail", "custom-imap"}, {item.provider for item in self.reader.read()})
    def test_summary_omits_credentials_locator_and_default(self):
        write_projection(self.root / "qq-mail.json"); summary = self.reader.read()[0].public_summary().to_dict(); serialized = json.dumps(summary)
        self.assertNotIn("top-secret", serialized); self.assertNotIn("locator", serialized.lower()); self.assertNotIn("default", summary)

if __name__ == "__main__": unittest.main()
