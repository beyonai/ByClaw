from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
MAIL_TESTS = SCRIPTS.parents[0] / "tests"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(MAIL_TESTS))

from _support import account
from mail_runtime.models import AccountConfig, AttachmentRequest, Draft, ErrorCode, ListRequest, MailRuntimeError


def iwhale_account(auth=None):
    value = account(provider="iwhalecloud")
    value["auth"] = auth or {"type": "BROWSER_SSO"}
    value["capabilityStatus"] = {name: "CONDITIONAL_EWS_ENTERPRISE_AUTH_OR_BROWSER_SSO" for name in value["capabilities"]}
    value["setupRequirements"] = ["SIGN_IN_WITH_BROWSER_OR_CONFIGURE_EWS"]
    return AccountConfig.from_mapping(value)


class FakeAdapter:
    def __init__(self, value=None, error=None): self.value, self.error, self.calls = value, error, []
    def __getattr__(self, name):
        def call(*args):
            self.calls.append((name, args))
            if self.error: raise self.error
            return self.value
        return call


class IWhaleBycliTest(unittest.TestCase):
    def test_browser_probe_invokes_only_metadata_operation_and_returns_no_data(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        seen = []
        def runner(argv, **_kwargs):
            seen.append(argv[2])
            class Result:
                returncode = 0
                stdout = b"{}"
                stderr = b""
            return Result()
        self.assertIsNone(BycliOwaAdapter(iwhale_account(), runner=runner).probe_connection())
        self.assertEqual(["probe"], seen)

    def test_public_locators_are_verified_and_lowered_before_browser_dispatch(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        from mail_runtime.locator_security import locator_key, sign_locator
        calls = []
        def runner(argv, **_kwargs):
            request = json.loads(Path(argv[-1]).read_text())
            calls.append((argv[2], request))
            class Result:
                returncode = 0
                stderr = b""
                stdout = b'{"messageId":{"id":"raw-next","changeKey":"next-ck"},"movedTo":"trash"}'
            return Result()
        current = iwhale_account()
        key = locator_key(current.locator_key)
        message = sign_locator("iwm1", {"v": 1, "p": "iwhalecloud", "a": current.account_id,
            "e": current.email.strip().lower(), "o": "message", "i": "raw-id", "c": "raw-ck"}, key)
        result = BycliOwaAdapter(current, runner=runner).delete_message(message)
        self.assertTrue(result.message_id.startswith("iwm1."))
        self.assertEqual({"id": "raw-id", "changeKey": "raw-ck"}, calls[0][1]["messageId"])
        self.assertNotIn(current.locator_key, json.dumps(calls[0][1]))

    def test_cross_account_and_message_attachment_locators_fail_before_browser_dispatch(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        from mail_runtime.locator_security import locator_key, sign_locator
        called = []
        source = iwhale_account()
        target_mapping = account(provider="iwhalecloud")
        target_mapping.update({"accountId": source.account_id, "email": "delegate@example.test",
            "auth": {"type": "BROWSER_SSO"}})
        target = AccountConfig.from_mapping(target_mapping)
        key = locator_key(source.locator_key)
        base = {"v": 1, "p": "iwhalecloud", "a": source.account_id,
            "e": source.email.strip().lower()}
        message = sign_locator("iwm1", {**base, "o": "message", "i": "source-item", "c": "source-ck"}, key)
        attachment = sign_locator("iwa1", {**base, "o": "attachment", "i": "source-item", "c": "source-ck", "x": "source-att"}, key)
        adapter = BycliOwaAdapter(target, runner=lambda *_a, **_k: called.append(True))
        for invoke in (
            lambda: adapter.get_message(message),
            lambda: adapter.reply_message(message, Draft(text="reply")),
            lambda: adapter.delete_message(message),
            lambda: adapter.download_attachment(AttachmentRequest(message, attachment), object()),
        ):
            with self.assertRaises(MailRuntimeError) as raised: invoke()
            self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)
        self.assertEqual([], called)
    def test_bounded_runner_classifies_setup_and_cleanup_failures_after_spawn(self):
        from mail_runtime.ews import PostDispatchProcessError, bounded_run

        class Stream:
            closed = False
            def close(self): self.closed = True
            def fileno(self): return 1

        class Process:
            returncode = 0
            stdin = None
            def __init__(self, fail): self.stdout, self.stderr, self.fail = Stream(), Stream(), fail
            def kill(self):
                if self.fail == "kill": raise OSError("private kill detail")
            def wait(self, timeout=None):
                if self.fail == "wait": raise OSError("private wait detail")
                return 0

        class Selector:
            def __init__(self, fail):
                if fail == "selector": raise OSError("private selector detail")
                self.fail = fail
            def register(self, *_args):
                if self.fail == "register": raise OSError("private register detail")
            def get_map(self): return {}
            def close(self):
                if self.fail == "close": raise OSError("private close detail")

        for phase in ("selector", "register", "wait", "kill", "close"):
            with self.subTest(phase=phase):
                process = Process(phase)
                selector_factory = lambda: Selector(phase)
                with patch("mail_runtime.ews.subprocess.Popen", return_value=process), \
                     patch("mail_runtime.ews.selectors.DefaultSelector", side_effect=selector_factory):
                    with self.assertRaises(PostDispatchProcessError) as raised:
                        bounded_run(["fixed"], timeout=-1 if phase == "kill" else 1)
                self.assertNotIn("private", str(raised.exception))

    def test_default_process_runner_stops_reading_at_output_cap(self):
        from mail_runtime.ews import bounded_run
        import sys
        result = bounded_run([sys.executable, "-c", "import os; os.write(1, b'x' * (11 * 1024 * 1024))"], timeout=5)
        self.assertNotEqual(0, result.returncode)
        self.assertLessEqual(len(result.stdout), 10 * 1024 * 1024 + 1)

    def test_default_process_runner_times_out_after_child_closes_streams(self):
        from mail_runtime.ews import bounded_run
        import subprocess
        import sys
        with self.assertRaises(subprocess.TimeoutExpired):
            bounded_run([sys.executable, "-c", "import os,time; os.close(1); os.close(2); time.sleep(5)"], timeout=0.1)

    def test_default_process_runner_classifies_post_spawn_stdin_failure(self):
        from mail_runtime.ews import PostDispatchProcessError, bounded_run
        import sys
        with self.assertRaises(PostDispatchProcessError):
            bounded_run([sys.executable, "-c", "import os,time; os.close(0); time.sleep(.2)"],
                        input=b"x" * (1024 * 1024), timeout=2)

    def test_bounded_runner_classifies_selector_poll_and_read_failures_after_spawn(self):
        from mail_runtime.ews import PostDispatchProcessError, bounded_run
        class Stream:
            closed = False
            def close(self): self.closed = True
            def fileno(self): return 3
        class Process:
            returncode = 0
            stdin = None
            def __init__(self): self.stdout, self.stderr = Stream(), Stream()
            def kill(self): pass
            def wait(self, timeout=None): return 0
        class Key:
            def __init__(self, stream): self.fileobj = stream
        class Selector:
            def __init__(self, phase, process): self.phase, self.process = phase, process
            def register(self, *_args): pass
            def get_map(self): return {1: True}
            def select(self, _timeout):
                if self.phase == "select": raise OSError("private poll detail")
                return [(Key(self.process.stdout), None)]
            def close(self): pass
        for phase in ("select", "read"):
            process = Process()
            with self.subTest(phase=phase), \
                 patch("mail_runtime.ews.subprocess.Popen", return_value=process), \
                 patch("mail_runtime.ews.selectors.DefaultSelector", return_value=Selector(phase, process)), \
                 patch("mail_runtime.ews.os.read", side_effect=OSError("private read detail")):
                with self.assertRaises(PostDispatchProcessError):
                    bounded_run(["fixed"], timeout=1)

    def test_bycli_invocation_uses_private_request_fixed_argv_and_unlinks(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        seen = {}
        def runner(argv, **kwargs):
            seen["argv"] = list(argv)
            request_path = Path(argv[-1])
            seen["mode"] = request_path.stat().st_mode & 0o777
            seen["request"] = json.loads(request_path.read_text())
            class Result:
                returncode = 0
                stdout = json.dumps({"items": [], "nextCursor": None}).encode()
                stderr = b""
            return Result()
        adapter = BycliOwaAdapter(iwhale_account(), runner=runner)
        self.assertEqual((), adapter.list_messages(ListRequest(limit=3)).items)
        self.assertEqual(["bycli", "mail-iwhalecloud", "list", "-f", "json", "--input"], seen["argv"][:-1])
        self.assertEqual(0o600, seen["mode"])
        self.assertEqual(3, seen["request"]["limit"])
        self.assertFalse(Path(seen["argv"][-1]).exists())

    def test_bycli_rejects_multiple_json_and_sanitizes_errors(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        class Result:
            returncode = 1
            stdout = b'{"secret":"cookie"}\n{"other":1}'
            stderr = b"session-token=secret"
        with self.assertRaises(MailRuntimeError) as raised:
            BycliOwaAdapter(iwhale_account(), runner=lambda *_a, **_k: Result()).list_messages(ListRequest())
        self.assertNotIn("secret", str(raised.exception))

    def test_bycli_sysexits_are_not_an_error_protocol(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        class Result:
            stdout = b""
            stderr = b"unsafe session detail"
            def __init__(self, code): self.returncode = code
        for exit_code in (77, 78, 69, 2, 66):
            with self.subTest(exit_code=exit_code):
                with self.assertRaises(MailRuntimeError) as raised:
                    BycliOwaAdapter(iwhale_account(), runner=lambda *_a, **_k: Result(exit_code)).list_messages(ListRequest())
                self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_bycli_nonzero_exit_is_never_used_as_an_error_protocol(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        class Result:
            stdout = b'{"error":{"code":"AUTH_REQUIRED"}}'
            stderr = b"secret=session-token"
            returncode = 77
        with self.assertRaises(MailRuntimeError) as raised:
            BycliOwaAdapter(iwhale_account(), runner=lambda *_a, **_k: Result()).list_messages(ListRequest())
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertNotIn("secret", str(raised.exception))

    def test_bycli_structured_error_envelopes_map_stably_without_secret_echo(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        for code, expected in (
            ("PERMISSION_DENIED", ErrorCode.PERMISSION_DENIED),
            ("RATE_LIMITED", ErrorCode.RATE_LIMITED),
            ("UPSTREAM_UNAVAILABLE", ErrorCode.UPSTREAM_UNAVAILABLE),
            ("AUTH_REQUIRED", ErrorCode.AUTH_REQUIRED),
            ("AUTH_EXPIRED", ErrorCode.AUTH_EXPIRED),
            ("NEW_PRIVATE_ERROR", ErrorCode.UPSTREAM_UNAVAILABLE),
        ):
            class Result:
                returncode = 0
                stderr = b"cookie=private"
                stdout = json.dumps({"error": {"code": code, "retryable": code == "RATE_LIMITED",
                                                "unsafeDetail": "token=private"}}).encode()
            with self.subTest(code=code), self.assertRaises(MailRuntimeError) as raised:
                BycliOwaAdapter(iwhale_account(), runner=lambda *_a, **_k: Result()).list_messages(ListRequest())
            self.assertEqual(expected, raised.exception.code)
            self.assertNotIn("private", str(raised.exception))

    def test_structured_browser_error_after_mutation_is_always_ambiguous(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        class Result:
            returncode = 0
            stderr = b""
            stdout = b'{"error":{"code":"AUTH_REQUIRED","retryable":false}}'
        with self.assertRaises(MailRuntimeError) as raised:
            BycliOwaAdapter(iwhale_account(), runner=lambda *_a, **_k: Result()).send_message(Draft(text="x"))
        self.assertEqual(ErrorCode.AUTH_REQUIRED, raised.exception.code)
        self.assertTrue(raised.exception.ambiguous)
        self.assertFalse(raised.exception.retryable)

    def test_get_refreshes_message_and_attachment_change_key_for_download_round_trip(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        calls = []
        current = iwhale_account()
        adapter = BycliOwaAdapter(current, runner=None)
        old_message = adapter._encode_message({"id": "item-1", "changeKey": "old-ck"})
        def runner(argv, **_kwargs):
            request = json.loads(Path(argv[-1]).read_text()); calls.append((argv[2], request))
            class Result: returncode = 0; stderr = b""
            result = Result()
            if argv[2] == "get":
                result.stdout = json.dumps({"messageId": {"id": "item-1", "changeKey": "new-ck"},
                    "subject": "x", "recipients": [], "attachments": [{"attachmentId": "att-1",
                    "filename": "a.txt", "size": 1, "contentType": "text/plain"}]}).encode()
            else:
                result.stdout = b'{"filename":"a.txt","contentType":"text/plain","contentBase64":"eA=="}'
            return result
        adapter._runner = runner
        message = adapter.get_message(old_message)
        class Sink:
            def write(self, filename, chunks, *, content_type=None):
                from mail_runtime.models import AttachmentDownloadResult
                return AttachmentDownloadResult(filename, len(b"".join(chunks)), content_type)
        adapter.download_attachment(AttachmentRequest(message.message_id, message.attachments[0].attachment_id), Sink())
        self.assertEqual({"id": "item-1", "changeKey": "new-ck"}, calls[1][1]["messageId"])
        self.assertEqual("att-1", calls[1][1]["attachmentId"])

    def test_get_rejects_response_item_mismatch(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        current = iwhale_account(); adapter = BycliOwaAdapter(current, runner=None)
        message = adapter._encode_message({"id": "item-1", "changeKey": "old-ck"})
        class Result:
            returncode = 0; stderr = b""
            stdout = b'{"messageId":{"id":"item-2","changeKey":"new-ck"},"subject":"x","recipients":[],"attachments":[]}'
        adapter._runner = lambda *_a, **_k: Result()
        with self.assertRaises(MailRuntimeError) as raised: adapter.get_message(message)
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_rate_limit_retry_after_is_bounded_and_preserved(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        class Result:
            returncode = 0; stderr = b""
            stdout = b'{"error":{"code":"RATE_LIMITED","retryable":true,"retryAfterMs":2500}}'
        with self.assertRaises(MailRuntimeError) as raised:
            BycliOwaAdapter(iwhale_account(), runner=lambda *_a, **_k: Result()).list_messages(ListRequest())
        self.assertEqual(2500, raised.exception.retry_after_ms)
        self.assertEqual(2500, raised.exception.as_dict()["retryAfterMs"])
        class Oversized(Result):
            stdout = b'{"error":{"code":"RATE_LIMITED","retryable":true,"retryAfterMs":3600001}}'
        with self.assertRaises(MailRuntimeError) as oversized:
            BycliOwaAdapter(iwhale_account(), runner=lambda *_a, **_k: Oversized()).list_messages(ListRequest())
        self.assertIsNone(oversized.exception.retry_after_ms)
        self.assertNotIn("retryAfterMs", oversized.exception.as_dict())

    def test_bycli_post_dispatch_send_error_is_ambiguous_and_never_replayed(self):
        from mail_runtime.ews import PostDispatchProcessError
        from mail_runtime.iwhale_bcli import BycliOwaAdapter, IWhaleCloudAdapter
        browser = BycliOwaAdapter(
            iwhale_account(), runner=lambda *_a, **_k: (_ for _ in ()).throw(PostDispatchProcessError())
        )
        adapter = IWhaleCloudAdapter(iwhale_account(), ews=None, browser=browser)
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(to=("a@example.test",), text="x"))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertTrue(raised.exception.ambiguous)

    def test_bycli_malformed_success_shape_after_mutation_is_ambiguous(self):
        from mail_runtime.iwhale_bcli import BycliOwaAdapter
        class Result:
            returncode = 0
            stdout = b"{}"
            stderr = b""
        with self.assertRaises(MailRuntimeError) as raised:
            BycliOwaAdapter(iwhale_account(), runner=lambda *_a, **_k: Result()).send_message(
                Draft(to=("a@example.test",), text="x")
            )
        self.assertTrue(raised.exception.ambiguous)

    def test_composite_prefers_ews_falls_back_deterministically_and_never_replays_ambiguous_mutation(self):
        from mail_runtime.iwhale_bcli import IWhaleCloudAdapter
        browser_value = object()
        browser = FakeAdapter(browser_value)
        ews = FakeAdapter(error=MailRuntimeError(ErrorCode.AUTH_REQUIRED, fallback_safe=True))
        adapter = IWhaleCloudAdapter(iwhale_account(), ews=ews, browser=browser)
        self.assertIs(browser_value, adapter.list_messages(ListRequest()))
        self.assertIs(browser_value, adapter.send_message(Draft(to=("a@example.test",), text="x")))
        ambiguous = FakeAdapter(error=MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=True))
        adapter = IWhaleCloudAdapter(iwhale_account(), ews=ambiguous, browser=browser)
        before = len(browser.calls)
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(to=("a@example.test",), text="x"))
        self.assertTrue(raised.exception.ambiguous)
        self.assertEqual(before, len(browser.calls))

        for method, args in (
            ("send_message", (Draft(to=("a@example.test",), text="x"),)),
            ("reply_message", ("ews1.dead", Draft(text="x"))),
            ("delete_message", ("ews1.dead",)),
        ):
            post_dispatch_auth = FakeAdapter(error=MailRuntimeError(ErrorCode.AUTH_REQUIRED))
            adapter = IWhaleCloudAdapter(iwhale_account(), ews=post_dispatch_auth, browser=browser)
            before = len(browser.calls)
            with self.assertRaises(MailRuntimeError):
                getattr(adapter, method)(*args)
            self.assertEqual(before, len(browser.calls), f"{method} replayed after EWS dispatch")

    def test_registry_routes_iwhalecloud_and_metadata_remains_conditional(self):
        from mail_runtime.iwhale_bcli import IWhaleCloudAdapter
        from mail_runtime.providers import capability_descriptor, setup_requirements
        from mail_runtime.registry import build_default_registry
        account_config = iwhale_account()
        self.assertIsInstance(build_default_registry().adapter_for(account_config), IWhaleCloudAdapter)
        self.assertEqual({"CONDITIONAL_EWS_ENTERPRISE_AUTH_OR_BROWSER_SSO"}, set(capability_descriptor(account_config).values()))
        self.assertEqual(("SIGN_IN_WITH_BROWSER_OR_CONFIGURE_EWS",), setup_requirements(account_config))


if __name__ == "__main__": unittest.main()
