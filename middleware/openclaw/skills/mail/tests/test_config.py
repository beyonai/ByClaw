from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from _support import account, write_projection
from mail_runtime.config import AccountProjectionReader
from mail_runtime.io_security import AnchoredPrivateReader
from mail_runtime.models import ErrorCode, MailRuntimeError


class AccountProjectionReaderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.base = Path(self.tempdir.name).resolve()
        self.root = self.base / "auth"
        self.root.mkdir(mode=0o700)
        self.path = self.root / "accounts.json"
        self.reader = AccountProjectionReader(self.root)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def assert_invalid(self, callback, code: ErrorCode = ErrorCode.INVALID_REQUEST) -> None:
        with self.assertRaises(MailRuntimeError) as raised:
            callback()
        self.assertEqual(code, raised.exception.code)

    def test_reads_private_projection_without_exposing_auth_in_summary(self) -> None:
        write_projection(self.path)
        accounts = self.reader.read()
        self.assertEqual("1001", accounts[0].account_id)
        self.assertEqual("top-secret", accounts[0].auth["secret"])
        public = json.dumps(accounts[0].public_summary().to_dict())
        self.assertNotIn("top-secret", public)
        self.assertNotIn("locatorKey", public)
        self.assertNotIn(accounts[0].locator_key, public)

    def test_shared_backend_projection_fixture_exposes_conditional_capabilities(self) -> None:
        fixture = Path(__file__).resolve().parent / "fixtures/backend_projection_accounts.json"
        self.path.write_bytes(fixture.read_bytes())
        os.chmod(self.path, 0o600)

        accounts = {item.provider: item for item in self.reader.read()}
        self.assertEqual("YES", accounts["fastmail"].capability_status["delete"])
        for provider in ("qq", "netease-163", "aliyun-mail"):
            self.assertNotIn("delete", accounts[provider].capabilities)
            self.assertEqual("CONDITIONAL_MOVE_OR_UIDPLUS", accounts[provider].capability_status["delete"])
        self.assertEqual(("ADMIN_ENABLE_THIRD_PARTY_CLIENT", "USE_SECURITY_PASSWORD"),
                         accounts["aliyun-mail"].setup_requirements)

    def test_rejects_non_0600_projection(self) -> None:
        for mode in (0o640, 0o644, 0o400, 0o700):
            with self.subTest(mode=oct(mode)):
                if self.path.exists():
                    os.chmod(self.path, 0o600)
                write_projection(self.path, mode=mode)
                self.assert_invalid(self.reader.read)

    def test_rejects_projection_owned_by_another_user(self) -> None:
        write_projection(self.path)
        with mock.patch("mail_runtime.io_security.os.geteuid", return_value=os.geteuid() + 1):
            self.assert_invalid(self.reader.read, ErrorCode.PERMISSION_DENIED)

    def test_rejects_projection_symlink(self) -> None:
        real = write_projection(self.root / "real.json")
        self.path.symlink_to(real)
        self.assert_invalid(self.reader.read)

    def test_rejects_symlinked_trusted_root(self) -> None:
        write_projection(self.path)
        linked_root = Path(self.tempdir.name) / "linked-auth"
        linked_root.symlink_to(self.root, target_is_directory=True)
        self.assert_invalid(
            AccountProjectionReader(linked_root).read,
            ErrorCode.PERMISSION_DENIED,
        )

    def test_rejects_symlink_in_higher_trusted_root_ancestor(self) -> None:
        external_parent = self.base / "external-parent"
        external_root = external_parent / "auth"
        external_root.mkdir(parents=True, mode=0o700)
        write_projection(external_root / "accounts.json", [account("external")])
        linked_parent = self.base / "linked-parent"
        linked_parent.symlink_to(external_parent, target_is_directory=True)

        self.assert_invalid(
            AccountProjectionReader(linked_parent / "auth").read,
            ErrorCode.PERMISSION_DENIED,
        )

    def test_anchored_reader_rejects_any_relative_ancestor_symlink(self) -> None:
        real_dir = self.root / "real"
        real_dir.mkdir(mode=0o700)
        target = real_dir / "draft.json"
        target.write_text("{}", encoding="utf-8")
        os.chmod(target, 0o600)
        (self.root / "linked").symlink_to(real_dir, target_is_directory=True)
        anchored = AnchoredPrivateReader(self.root, max_bytes=1024)
        self.assert_invalid(
            lambda: anchored.read_json(Path("linked/draft.json")),
            ErrorCode.PERMISSION_DENIED,
        )

    def test_anchored_reader_uses_open_fd_when_leaf_is_swapped(self) -> None:
        original_payload = {"value": "original"}
        replacement_payload = {"value": "replacement"}
        target = self.root / "draft.json"
        target.write_text(json.dumps(original_payload), encoding="utf-8")
        os.chmod(target, 0o600)
        replacement = self.root / "replacement.json"
        replacement.write_text(json.dumps(replacement_payload), encoding="utf-8")
        os.chmod(replacement, 0o600)
        real_read = os.read
        swapped = False

        def swap_then_read(fd: int, size: int) -> bytes:
            nonlocal swapped
            if not swapped:
                swapped = True
                target.rename(self.root / "old.json")
                replacement.rename(target)
            return real_read(fd, size)

        with mock.patch("mail_runtime.io_security.os.read", side_effect=swap_then_read):
            result = AnchoredPrivateReader(self.root, max_bytes=1024).read_json(Path("draft.json"))
        self.assertEqual(original_payload, result)

    def test_rejects_duplicate_ids_oversize_invalid_schema_and_controls(self) -> None:
        write_projection(self.path, [account("1001"), account("1001", "gmail")])
        self.assert_invalid(self.reader.read)
        self.path.write_bytes(b"{" + b"x" * (64 * 1024))
        os.chmod(self.path, 0o600)
        self.assert_invalid(self.reader.read)
        bad = account()
        bad["displayName"] = "bad\u0000name"
        write_projection(self.path, [bad])
        self.assert_invalid(self.reader.read)
        self.path.write_text(json.dumps({"schemaVersion": 2, "accounts": []}), encoding="utf-8")
        os.chmod(self.path, 0o600)
        self.assert_invalid(self.reader.read)


if __name__ == "__main__":
    unittest.main()
