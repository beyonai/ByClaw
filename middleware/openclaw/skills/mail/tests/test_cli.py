from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from _support import account, write_projection
from mailctl import EXIT_CODES, main
from mail_runtime.models import (
    MessageSummary,
    ErrorCode,
    MailRuntimeError,
    Page,
)
from mail_runtime.registry import AdapterRegistry
from test_contract import RecordingAdapter


class MailctlTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name).resolve()
        self.auth_root = self.root / "auth"
        self.auth_root.mkdir(mode=0o700)
        self.config = write_projection(self.auth_root / "accounts.json")
        self.workspace = self.root / "workspace"
        self.workspace.mkdir(mode=0o700)
        os.chmod(self.workspace, 0o700)
        self.adapter = RecordingAdapter()
        self.registry = AdapterRegistry()
        self.registry.register("qq", lambda _: self.adapter)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def run_cli(
        self,
        argv: list[str],
        registry: AdapterRegistry | None = None,
        workspace_root: Path | None = None,
    ) -> tuple[int, dict, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = main(
                argv,
                config_root=self.auth_root,
                workspace_root=workspace_root or self.workspace,
                registry=registry or self.registry,
            )
        lines = stdout.getvalue().splitlines()
        self.assertEqual(1, len(lines), stdout.getvalue())
        return code, json.loads(lines[0]), stderr.getvalue()

    def write_input(self, payload: dict, name: str = "draft.json", mode: int = 0o600) -> Path:
        directory = self.workspace / "drafts"
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        os.chmod(path, mode)
        return path

    def test_accounts_returns_only_safe_public_metadata(self) -> None:
        code, result, stderr = self.run_cli(["accounts"])
        self.assertEqual(0, code)
        self.assertEqual({"ok", "operation", "accountId", "data"}, set(result))
        self.assertEqual("accounts", result["operation"])
        self.assertIsNone(result["accountId"])
        self.assertNotIn("top-secret", json.dumps(result))
        self.assertNotIn("auth", json.dumps(result))
        self.assertEqual("", stderr)

    def test_all_commands_return_stable_success_envelopes(self) -> None:
        draft = self.write_input({"to": ["to@example.com"], "subject": "hello", "text": "secret body"})
        commands = [
            ["list", "--account", "1001"],
            ["get", "--account", "1001", "--message", "m1"],
            ["search", "--account", "1001", "--query", "hello"],
            [
                "attachment", "--account", "1001", "--message", "m1", "--attachment", "a1",
                "--output-dir", str(self.workspace / "downloads"),
            ],
            ["send", "--account", "1001", "--input-json", str(draft)],
            ["reply", "--account", "1001", "--message", "m1", "--input-json", str(draft)],
            ["delete", "--account", "1001", "--message", "m1"],
        ]
        for argv in commands:
            with self.subTest(command=argv[0]):
                code, result, stderr = self.run_cli(argv)
                self.assertEqual(0, code)
                self.assertEqual({"ok", "operation", "accountId", "data"}, set(result))
                self.assertEqual(argv[0], result["operation"])
                self.assertEqual("1001", result["accountId"])
                self.assertEqual("", stderr)
        downloaded = self.workspace / "downloads" / "report.txt"
        self.assertEqual(0o600, downloaded.stat().st_mode & 0o777)
        self.assertEqual(os.geteuid(), downloaded.stat().st_uid)

    def test_check_uses_metadata_probe_and_returns_only_safe_capability_status(self) -> None:
        class SensitiveMessageAdapter(RecordingAdapter):
            def probe_connection(inner_self):
                inner_self.calls.append("probe")

            def list_messages(inner_self, request):
                raise AssertionError("check must not list messages")

        adapter = SensitiveMessageAdapter()
        registry = AdapterRegistry()
        registry.register("qq", lambda _: adapter)

        code, result, stderr = self.run_cli(["check", "--account", "1001"], registry)

        self.assertEqual(0, code)
        self.assertEqual("check", result["operation"])
        self.assertEqual("1001", result["accountId"])
        self.assertEqual(
            {"status", "latencyMs", "capabilityStatus"},
            set(result["data"]),
        )
        self.assertEqual("NORMAL", result["data"]["status"])
        self.assertGreaterEqual(result["data"]["latencyMs"], 0)
        self.assertEqual({capability: "YES" for capability in (
            "list", "get", "search", "downloadAttachment", "send", "reply", "delete"
        )}, result["data"]["capabilityStatus"])
        serialized = json.dumps(result)
        for secret in ("message-secret-id", "message-secret-subject", "sender@example.com", "top-secret", "person@example.com"):
            self.assertNotIn(secret, serialized)
        self.assertEqual(["probe"], adapter.calls)
        self.assertEqual("", stderr)

    def test_check_preserves_conditional_capabilities_as_partial(self) -> None:
        projection = write_projection(self.config, [{
            **account(),
            "capabilityStatus": {
                "list": "YES",
                "get": "YES",
                "search": "CONDITIONAL_SERVER_SEARCH",
                "downloadAttachment": "YES",
                "send": "YES",
                "reply": "CONDITIONAL_REPLY_METADATA",
                "delete": "NO",
            },
        }])
        self.assertEqual(self.config, projection)

        code, result, _ = self.run_cli(["check", "--account", "1001"])

        self.assertEqual(0, code)
        self.assertEqual("PARTIAL", result["data"]["status"])
        self.assertEqual("CONDITIONAL_SERVER_SEARCH", result["data"]["capabilityStatus"]["search"])
        self.assertEqual("CONDITIONAL_REPLY_METADATA", result["data"]["capabilityStatus"]["reply"])
        self.assertEqual("NO", result["data"]["capabilityStatus"]["delete"])

    def test_check_returns_stable_safe_adapter_error(self) -> None:
        class FailingAdapter(RecordingAdapter):
            def probe_connection(self):
                raise MailRuntimeError(ErrorCode.AUTH_EXPIRED, "token=adapter-secret")

        registry = AdapterRegistry()
        registry.register("qq", lambda _: FailingAdapter())

        code, result, stderr = self.run_cli(["check", "--account", "1001"], registry)

        self.assertEqual(EXIT_CODES[ErrorCode.AUTH_EXPIRED], code)
        self.assertEqual("AUTH_EXPIRED", result["error"]["code"])
        self.assertNotIn("adapter-secret", json.dumps(result))
        self.assertEqual("", stderr)

    def test_ready_iwhalecloud_projection_fixture_reaches_registry_for_all_operations(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "backend_projection_accounts.json"
        shutil.copyfile(fixture, self.config)
        os.chmod(self.config, 0o600)
        registry = AdapterRegistry()
        registry.register("iwhalecloud", lambda _: self.adapter)
        draft = self.write_input({"to": ["to@example.com"], "text": "body"}, "iwhale.json")
        commands = [
            ["list", "--account", "iwhalecloud-fixture"],
            ["get", "--account", "iwhalecloud-fixture", "--message", "m1"],
            ["search", "--account", "iwhalecloud-fixture", "--query", "hello"],
            ["attachment", "--account", "iwhalecloud-fixture", "--message", "m1", "--attachment", "a1", "--output-dir", str(self.workspace / "iwhale-downloads")],
            ["send", "--account", "iwhalecloud-fixture", "--input-json", str(draft)],
            ["reply", "--account", "iwhalecloud-fixture", "--message", "m1", "--input-json", str(draft)],
            ["delete", "--account", "iwhalecloud-fixture", "--message", "m1"],
        ]
        for command in commands:
            code, result, _ = self.run_cli(command, registry=registry)
            self.assertEqual(0, code, result)
            self.assertTrue(result["ok"])

    def test_input_json_is_anchored_private_and_workspace_only(self) -> None:
        payload = {"to": ["to@example.com"], "text": "body"}
        outside = self.root / "outside.json"
        outside.write_text(json.dumps(payload), encoding="utf-8")
        os.chmod(outside, 0o600)
        world_readable = self.write_input(payload, "world.json", mode=0o644)
        real_dir = self.workspace / "real-drafts"
        real_dir.mkdir(mode=0o700)
        linked = self.workspace / "linked-drafts"
        linked.symlink_to(real_dir, target_is_directory=True)
        linked_file = real_dir / "linked.json"
        linked_file.write_text(json.dumps(payload), encoding="utf-8")
        os.chmod(linked_file, 0o600)
        for input_path in (outside, world_readable, linked / "linked.json"):
            with self.subTest(path=input_path):
                code, result, _ = self.run_cli([
                    "send", "--account", "1001", "--input-json", str(input_path),
                ])
                self.assertNotEqual(0, code)
                self.assertIn(result["error"]["code"], {"INVALID_REQUEST", "PERMISSION_DENIED"})

    def test_workspace_trusted_root_rejects_symlink_in_higher_ancestor(self) -> None:
        external_parent = self.root / "external-parent"
        external_workspace = external_parent / "workspace"
        external_workspace.mkdir(parents=True, mode=0o700)
        os.chmod(external_workspace, 0o700)
        draft = external_workspace / "draft.json"
        draft.write_text(json.dumps({"to": ["to@example.com"], "text": "external-secret"}), encoding="utf-8")
        os.chmod(draft, 0o600)
        linked_parent = self.root / "linked-parent"
        linked_parent.symlink_to(external_parent, target_is_directory=True)

        code, result, _ = self.run_cli(
            ["send", "--account", "1001", "--input-json", str(linked_parent / "workspace" / "draft.json")],
            registry=self.registry,
            workspace_root=linked_parent / "workspace",
        )
        self.assertNotEqual(0, code)
        self.assertEqual("PERMISSION_DENIED", result["error"]["code"])
        self.assertNotIn("external-secret", json.dumps(result))

    def test_attachment_sink_rejects_outside_symlink_leaf_and_insecure_directory(self) -> None:
        outside = self.root / "outside"
        outside.mkdir(mode=0o700)
        symlink_dir = self.workspace / "escape"
        symlink_dir.symlink_to(outside, target_is_directory=True)
        insecure = self.workspace / "insecure"
        insecure.mkdir(mode=0o700)
        os.chmod(insecure, 0o644)
        leaf_dir = self.workspace / "leaf"
        leaf_dir.mkdir(mode=0o700)
        victim = outside / "victim.txt"
        victim.write_text("unchanged", encoding="utf-8")
        (leaf_dir / "report.txt").symlink_to(victim)
        for output in (outside, symlink_dir, insecure, leaf_dir):
            with self.subTest(output=output):
                code, result, _ = self.run_cli([
                    "attachment", "--account", "1001", "--message", "m1", "--attachment", "a1",
                    "--output-dir", str(output),
                ])
                self.assertNotEqual(0, code)
                self.assertEqual("PERMISSION_DENIED", result["error"]["code"])
                self.assertEqual("unchanged", victim.read_text(encoding="utf-8"))

    def test_attachment_sink_stays_anchored_during_parent_swap(self) -> None:
        outside = self.root / "outside"
        outside.mkdir(mode=0o700)
        victim = outside / "report.txt"
        victim.write_text("unchanged", encoding="utf-8")
        output = self.workspace / "downloads"

        class SwapAdapter(RecordingAdapter):
            def download_attachment(inner_self, request, sink):
                def chunks():
                    output.rename(self.workspace / "moved-downloads")
                    output.symlink_to(outside, target_is_directory=True)
                    yield b"new attachment"
                return sink.write("report.txt", chunks(), content_type="text/plain")

        registry = AdapterRegistry()
        registry.register("qq", lambda _: SwapAdapter())
        code, result, _ = self.run_cli([
            "attachment", "--account", "1001", "--message", "m1", "--attachment", "a1",
            "--output-dir", str(output),
        ], registry)
        self.assertNotEqual(0, code)
        self.assertEqual("PERMISSION_DENIED", result["error"]["code"])
        self.assertEqual("unchanged", victim.read_text(encoding="utf-8"))

    def test_attachment_sink_rejects_workspace_root_rename_and_replacement(self) -> None:
        output = self.workspace / "downloads"
        moved_workspace = self.root / "moved-workspace"

        class RootSwapAdapter(RecordingAdapter):
            def download_attachment(inner_self, request, sink):
                def chunks():
                    self.workspace.rename(moved_workspace)
                    self.workspace.mkdir(mode=0o700)
                    os.chmod(self.workspace, 0o700)
                    replacement_output = self.workspace / "downloads"
                    replacement_output.mkdir(mode=0o700)
                    (replacement_output / "victim.txt").write_text("unchanged", encoding="utf-8")
                    yield b"new attachment"
                return sink.write("report.txt", chunks(), content_type="text/plain")

        registry = AdapterRegistry()
        registry.register("qq", lambda _: RootSwapAdapter())
        code, result, _ = self.run_cli([
            "attachment", "--account", "1001", "--message", "m1", "--attachment", "a1",
            "--output-dir", str(output),
        ], registry)

        self.assertNotEqual(0, code)
        self.assertEqual("PERMISSION_DENIED", result["error"]["code"])
        replacement = self.workspace / "downloads"
        self.assertFalse((replacement / "report.txt").exists())
        self.assertEqual("unchanged", (replacement / "victim.txt").read_text(encoding="utf-8"))

    def test_nested_invalid_adapter_result_is_not_serialized(self) -> None:
        leaked_page = object.__new__(Page)
        object.__setattr__(leaked_page, "items", ({"accessToken": "top-secret"},))
        object.__setattr__(leaked_page, "next_cursor", None)

        class LeakyAdapter(RecordingAdapter):
            def list_messages(self, request):
                return leaked_page

        registry = AdapterRegistry()
        registry.register("qq", lambda _: LeakyAdapter())
        code, result, _ = self.run_cli(["list", "--account", "1001"], registry)
        self.assertNotEqual(0, code)
        self.assertEqual("INTERNAL_ERROR", result["error"]["code"])
        self.assertNotIn("top-secret", json.dumps(result))

        summary = MessageSummary("m1", "safe")
        object.__setattr__(summary, "subject", {"accessToken": "nested-top-secret"})
        tampered_page = Page((summary,))

        class TamperedAdapter(RecordingAdapter):
            def list_messages(self, request):
                return tampered_page

        registry = AdapterRegistry()
        registry.register("qq", lambda _: TamperedAdapter())
        code, result, _ = self.run_cli(["list", "--account", "1001"], registry)
        self.assertNotEqual(0, code)
        self.assertEqual("INTERNAL_ERROR", result["error"]["code"])
        self.assertNotIn("nested-top-secret", json.dumps(result))

    def test_errors_do_not_echo_unvalidated_operation_account_or_details(self) -> None:
        code, result, stderr = self.run_cli(["token=top-secret"])
        self.assertEqual(EXIT_CODES[ErrorCode.INVALID_REQUEST], code)
        self.assertIsNone(result["operation"])
        self.assertIsNone(result["accountId"])
        self.assertNotIn("top-secret", json.dumps(result))
        self.assertEqual("", stderr)

        code, result, _ = self.run_cli(["list", "--account", "bad\u0000token=top-secret"])
        self.assertEqual(EXIT_CODES[ErrorCode.INVALID_REQUEST], code)
        self.assertEqual("list", result["operation"])
        self.assertIsNone(result["accountId"])
        self.assertNotIn("top-secret", json.dumps(result))

        code, result, _ = self.run_cli([
            "send", "--account", "1001", "--input-json",
            str(self.workspace / "bad\u0000token=top-secret.json"),
        ])
        self.assertEqual(EXIT_CODES[ErrorCode.INVALID_REQUEST], code)
        self.assertNotIn("top-secret", json.dumps(result))

        class ExpiredAdapter(RecordingAdapter):
            def list_messages(self, request):
                raise MailRuntimeError(ErrorCode.AUTH_EXPIRED, "token=top-secret")

        registry = AdapterRegistry()
        registry.register("qq", lambda _: ExpiredAdapter())
        code, result, _ = self.run_cli(["list", "--account", "1001"], registry)
        self.assertEqual(EXIT_CODES[ErrorCode.AUTH_EXPIRED], code)
        self.assertNotIn("top-secret", json.dumps(result))

    def test_exit_code_mapping_is_exact(self) -> None:
        self.assertEqual({
            ErrorCode.INVALID_REQUEST: 2,
            ErrorCode.ACCOUNT_NOT_FOUND: 3,
            ErrorCode.AUTH_REQUIRED: 4,
            ErrorCode.AUTH_EXPIRED: 4,
            ErrorCode.PERMISSION_DENIED: 5,
            ErrorCode.MESSAGE_NOT_FOUND: 6,
            ErrorCode.ATTACHMENT_NOT_FOUND: 6,
            ErrorCode.RATE_LIMITED: 7,
            ErrorCode.UPSTREAM_UNAVAILABLE: 7,
            ErrorCode.UNSUPPORTED: 8,
            ErrorCode.INTERNAL_ERROR: 10,
        }, EXIT_CODES)

    def test_root_help_flags_return_safe_command_reference(self) -> None:
        for argv in (["--help"], ["-h"]):
            with self.subTest(argv=argv):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    code = main(list(argv), config_root=self.auth_root, workspace_root=self.workspace)
                self.assertEqual(0, code)
                self.assertEqual("", stderr.getvalue())
                self.assertIn("Unified mail connector runtime", stdout.getvalue())
                for command in ("accounts", "check", "list", "get", "search", "attachment", "send", "reply", "delete"):
                    self.assertIn(command, stdout.getvalue())

    def test_subcommand_help_remains_a_single_json_invalid_request(self) -> None:
        code, result, stderr = self.run_cli(["list", "--help"])
        self.assertEqual(EXIT_CODES[ErrorCode.INVALID_REQUEST], code)
        self.assertFalse(result["ok"])
        self.assertEqual("INVALID_REQUEST", result["error"]["code"])
        self.assertEqual("", stderr)

    def test_real_subprocess_emits_one_json_line_empty_stderr_and_exact_exit(self) -> None:
        runner = (
            "from pathlib import Path; from mailctl import main; import sys; "
            "raise SystemExit(main(sys.argv[3:], config_root=Path(sys.argv[1]), "
            "workspace_root=Path(sys.argv[2])))"
        )
        environment = dict(os.environ)
        environment["PYTHONPATH"] = str(SCRIPTS)
        cases = (
            (["accounts"], 0),
            (["list", "--account", "missing"], 3),
            ([], 2),
        )
        for command, expected_exit in cases:
            completed = subprocess.run(
                [sys.executable, "-c", runner, str(self.auth_root), str(self.workspace), *command],
                capture_output=True,
                text=True,
                env=environment,
                check=False,
            )
            with self.subTest(command=command):
                self.assertEqual(expected_exit, completed.returncode)
                self.assertEqual("", completed.stderr)
                self.assertEqual(1, len(completed.stdout.splitlines()))
                json.loads(completed.stdout)

        for command in (["--help"], ["-h"]):
            completed = subprocess.run(
                [sys.executable, "-c", runner, str(self.auth_root), str(self.workspace), *command],
                capture_output=True,
                text=True,
                env=environment,
                check=False,
            )
            with self.subTest(command=command):
                self.assertEqual(0, completed.returncode)
                self.assertEqual("", completed.stderr)
                self.assertIn("Unified mail connector runtime", completed.stdout)


if __name__ == "__main__":
    unittest.main()
