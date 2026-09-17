from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from _support import account
from mail_runtime.io_security import AttachmentSink
from mail_runtime.mime import normalize_body, safe_filename
from mail_runtime.models import (
    AccountConfig,
    AttachmentMeta,
    AttachmentDownloadResult,
    AttachmentRequest,
    DeleteResult,
    Draft,
    ErrorCode,
    ListRequest,
    MailRuntimeError,
    MessageContent,
    MessageSummary,
    Page,
    ReplyResult,
    SearchRequest,
    SendResult,
    to_jsonable,
)
from mail_runtime.registry import AdapterRegistry, MailAdapter


class RecordingAdapter:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def probe_connection(self) -> None:
        self.calls.append("probe")

    def list_messages(self, request: ListRequest) -> Page:
        self.calls.append("list")
        return Page(items=(MessageSummary("m1", "hello"),), next_cursor=None)

    def get_message(self, message_id: str) -> MessageContent:
        self.calls.append("get")
        return MessageContent(
            message_id=message_id,
            subject="hello",
            text="body",
            attachments=(AttachmentMeta("a1", "report.txt", 10, "text/plain"),),
        )

    def search_messages(self, request: SearchRequest) -> Page:
        self.calls.append("search")
        return Page(items=(MessageSummary("m1", "hello"),), next_cursor="next")

    def download_attachment(self, request: AttachmentRequest, sink: AttachmentSink):
        self.calls.append("attachment")
        return sink.write("report.txt", (b"attachment",), content_type="text/plain")

    def send_message(self, draft: Draft) -> SendResult:
        self.calls.append("send")
        return SendResult(message_id="sent-1")

    def reply_message(self, message_id: str, draft: Draft) -> ReplyResult:
        self.calls.append("reply")
        return ReplyResult(message_id="reply-1")

    def delete_message(self, message_id: str) -> DeleteResult:
        self.calls.append("delete")
        return DeleteResult(message_id=message_id, moved_to="trash")


class AdapterContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.workspace = Path(self.tempdir.name).resolve() / "workspace"
        self.workspace.mkdir(mode=0o700)
        os.chmod(self.workspace, 0o700)
        self.account = AccountConfig.from_mapping(account())
        self.adapter = RecordingAdapter()
        self.registry = AdapterRegistry()
        self.registry.register("qq", lambda _: self.adapter)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_protocol_is_runtime_checkable_and_has_metadata_probe_plus_seven_operations(self) -> None:
        expected = {
            "probe_connection",
            "list_messages", "get_message", "search_messages", "download_attachment",
            "send_message", "reply_message", "delete_message",
        }
        methods = {name for name in MailAdapter.__dict__ if not name.startswith("_")}
        self.assertEqual(expected, methods)
        self.assertIsInstance(self.adapter, MailAdapter)

    def test_registry_probe_calls_only_metadata_probe(self) -> None:
        statuses = self.registry.probe(self.account)
        self.assertEqual(["probe"], self.adapter.calls)
        self.assertEqual("YES", statuses["list"])

    def test_registry_rejects_incomplete_adapter_at_factory_boundary(self) -> None:
        class IncompleteAdapter:
            def list_messages(self, request):
                return Page(items=())

        registry = AdapterRegistry()
        registry.register("qq", lambda _: IncompleteAdapter())
        with self.assertRaises(MailRuntimeError) as raised:
            registry.adapter_for(self.account)
        self.assertEqual(ErrorCode.INTERNAL_ERROR, raised.exception.code)

    def test_registry_rejects_non_callable_protocol_attributes(self) -> None:
        class IntegerAdapter:
            list_messages = 1
            get_message = 2
            search_messages = 3
            download_attachment = 4
            send_message = 5
            reply_message = 6
            delete_message = 7

        registry = AdapterRegistry()
        registry.register("qq", lambda _: IntegerAdapter())
        with self.assertRaises(MailRuntimeError) as raised:
            registry.adapter_for(self.account)
        self.assertEqual(ErrorCode.INTERNAL_ERROR, raised.exception.code)

    def test_registered_adapter_runs_all_seven_operations(self) -> None:
        adapter = self.registry.adapter_for(self.account)
        draft = Draft(to=("to@example.com",), subject="subject", text="body")
        adapter.list_messages(ListRequest(folder="inbox", limit=20, cursor=None))
        adapter.get_message("m1")
        adapter.search_messages(SearchRequest(query="hello", limit=20, cursor=None))
        with AttachmentSink(self.workspace, self.workspace / "downloads") as sink:
            adapter.download_attachment(AttachmentRequest("m1", "a1"), sink)
        adapter.send_message(draft)
        adapter.reply_message("m1", draft)
        adapter.delete_message("m1")
        self.assertEqual(["list", "get", "search", "attachment", "send", "reply", "delete"], self.adapter.calls)

    def test_result_models_reject_untyped_nested_payloads(self) -> None:
        with self.assertRaises(MailRuntimeError):
            Page(items=({"accessToken": "top-secret"},))
        with self.assertRaises(MailRuntimeError):
            MessageContent(message_id="m1", attachments=({"raw": "top-secret"},))
        with self.assertRaises(MailRuntimeError):
            to_jsonable({"accessToken": "top-secret"})
        with self.assertRaises(MailRuntimeError):
            MessageSummary({"accessToken": "top-secret"}, "subject")
        with self.assertRaises(MailRuntimeError):
            AttachmentDownloadResult("report.txt", 1, {"raw": "top-secret"})

        summary = MessageSummary("m1", "safe")
        object.__setattr__(summary, "subject", {"accessToken": "top-secret"})
        with self.assertRaises(MailRuntimeError):
            to_jsonable(Page((summary,)))

        attachment = AttachmentMeta("a1", "safe.txt", 1, "text/plain")
        object.__setattr__(attachment, "filename", {"accessToken": "top-secret"})
        content = MessageContent("m1", text="safe", attachments=(attachment,))
        with self.assertRaises(MailRuntimeError):
            to_jsonable(content)

        body = MessageContent("m1", text="safe")
        object.__setattr__(body, "text", {"accessToken": "top-secret"})
        with self.assertRaises(MailRuntimeError):
            to_jsonable(body)

        summary_dto = self.account.public_summary()
        object.__setattr__(summary_dto, "capabilities", ({"accessToken": "top-secret"},))
        with self.assertRaises(MailRuntimeError):
            summary_dto.to_dict()

        send_result = SendResult("sent-1")
        object.__setattr__(send_result, "message_id", "")
        with self.assertRaises(MailRuntimeError):
            to_jsonable(send_result)

    def test_partial_delivery_result_has_typed_accepted_and_rejected_addresses(self) -> None:
        result = SendResult("sent-1", accepted=("ok@example.test",), rejected=("bad@example.test",), partial=True)
        self.assertEqual(
            {
                "messageId": "sent-1",
                "accepted": ["ok@example.test"],
                "rejected": ["bad@example.test"],
                "partial": True,
            },
            to_jsonable(result),
        )

    def test_sink_hides_paths_and_rejects_wrong_directory_owner(self) -> None:
        with AttachmentSink(self.workspace, self.workspace / "downloads") as sink:
            self.assertFalse(hasattr(sink, "workspace_root"))
            self.assertFalse(hasattr(sink, "output_directory"))
        with mock.patch("mail_runtime.io_security.os.geteuid", return_value=os.geteuid() + 1):
            with self.assertRaises(MailRuntimeError) as raised:
                with AttachmentSink(self.workspace, self.workspace / "other"):
                    pass
        self.assertEqual(ErrorCode.PERMISSION_DENIED, raised.exception.code)

    def test_sink_failure_closes_every_directory_descriptor(self) -> None:
        insecure = self.workspace / "insecure"
        insecure.mkdir(mode=0o700)
        os.chmod(insecure, 0o755)
        before = len(os.listdir("/dev/fd"))
        for _ in range(20):
            with self.assertRaises(MailRuntimeError):
                with AttachmentSink(self.workspace, insecure):
                    pass
        self.assertEqual(before, len(os.listdir("/dev/fd")))

    def test_sink_rejects_direct_parent_writable_by_non_owner(self) -> None:
        parent = self.workspace.parent
        original_mode = parent.stat().st_mode & 0o777
        os.chmod(parent, 0o777)
        try:
            with self.assertRaises(MailRuntimeError) as raised:
                with AttachmentSink(self.workspace, self.workspace / "downloads"):
                    pass
            self.assertEqual(ErrorCode.PERMISSION_DENIED, raised.exception.code)
        finally:
            os.chmod(parent, original_mode)

    def test_mime_helpers_reject_traversal_and_controls(self) -> None:
        for name in ("../secret", "folder/file.txt", "folder\\file.txt", ".", "..", "bad\u0000.txt"):
            with self.subTest(name=name), self.assertRaises(MailRuntimeError):
                safe_filename(name)
        with self.assertRaises(MailRuntimeError):
            normalize_body("body\u0000secret")
        self.assertEqual("line1\nline2", normalize_body("line1\r\nline2"))


if __name__ == "__main__":
    unittest.main()
