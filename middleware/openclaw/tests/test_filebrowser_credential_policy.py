import importlib.util
from pathlib import Path
import sys
import types
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "filebrowser-ui-proxy.py"
if "cgi" not in sys.modules:
    sys.modules["cgi"] = types.ModuleType("cgi")
SPEC = importlib.util.spec_from_file_location("openclaw_filebrowser_ui_proxy", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FileBrowserCredentialPolicyTest(unittest.TestCase):

    def test_credential_directory_and_descendants_are_protected(self):
        self.assertTrue(MODULE.is_protected_virtual_path("/.connector-auth"))
        self.assertTrue(MODULE.is_protected_virtual_path("/.connector-auth/.github/credential.json"))
        self.assertTrue(MODULE.is_protected_virtual_path("/by/.connector-auth/.github/credential.json"))

    def test_similarly_named_directory_is_not_protected(self):
        self.assertFalse(MODULE.is_protected_virtual_path("/.connector-auth-backup"))
        self.assertFalse(MODULE.is_protected_virtual_path("/.openclaw"))

    def test_native_file_api_is_not_forwarded_to_noauth_upstream(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('self.send_error_json(404, "native file API is disabled")', source)


if __name__ == "__main__":
    unittest.main()
