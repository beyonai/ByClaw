from __future__ import annotations

import base64
import json
import socket
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPSHandler
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

try:
    from ._support import account
except ImportError:
    from _support import account

from mail_runtime.gmail import GmailAdapter, UrllibGmailHttpClient, _NoRedirect
from mail_runtime.io_security import AttachmentSink
from mail_runtime.models import (
    AccountConfig,
    AttachmentRequest,
    Draft,
    ErrorCode,
    ListRequest,
    MailRuntimeError,
    SearchRequest,
)
from mail_runtime.registry import build_default_registry


def gmail_account(*, token: str = "access-secret") -> AccountConfig:
    value = account(provider="gmail")
    value["auth"] = {"type": "OAUTH2", "accessToken": token}
    value.pop("server", None)
    return AccountConfig.from_mapping(value)


def encoded(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def full_message(message_id="g123", *, attachment=True):
    parts = [
        {
            "partId": "0",
            "mimeType": "text/plain",
            "filename": "",
            "headers": [{"name": "Content-Type", "value": "text/plain; charset=utf-8"}],
            "body": {"size": 10, "data": encoded("plain body".encode())},
        },
        {
            "partId": "1",
            "mimeType": "text/html",
            "filename": "",
            "headers": [{"name": "Content-Type", "value": "text/html; charset=utf-8"}],
            "body": {"size": 16, "data": encoded(b"<p>html body</p>")},
        },
    ]
    if attachment:
        parts.append(
            {
                "partId": "2",
                "mimeType": "application/pdf",
                "filename": "report.pdf",
                "headers": [],
                "body": {"attachmentId": "att-77", "size": 7},
            }
        )
    return {
        "id": message_id,
        "threadId": "thread-9",
        "labelIds": ["INBOX", "UNREAD"],
        "snippet": "preview",
        "internalDate": "1788141600000",
        "payload": {
            "partId": "",
            "mimeType": "multipart/mixed",
            "filename": "",
            "headers": [
                {"name": "Message-ID", "value": "<original@example.test>"},
                {"name": "References", "value": "<root@example.test>"},
                {"name": "Subject", "value": "=?utf-8?b?5rWL6K+V5Li76aKY?="},
                {"name": "From", "value": "Sender <sender@example.test>"},
                {"name": "Reply-To", "value": "reply@example.test"},
                {"name": "To", "value": "Person <person@example.com>"},
                {"name": "Date", "value": "Mon, 31 Aug 2026 10:00:00 +0800"},
            ],
            "body": {"size": 0},
            "parts": parts,
        },
    }


def inline_attachment_message(data: bytes = b"PDFDATA"):
    value = full_message(attachment=False)
    value["payload"]["parts"].append({
        "partId": "inline-2",
        "mimeType": "application/pdf",
        "filename": "inline.pdf",
        "headers": [],
        "body": {"size": len(data), "data": encoded(data)},
    })
    return value


class FakeResponse:
    def __init__(self, status: int, payload, headers=None):
        self.status = status
        self.headers = {"Content-Type": "application/json", **(headers or {})}
        self.body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.closed = False

    def read(self, amount=-1):
        if amount is None or amount < 0:
            return self.body
        return self.body[:amount]

    def close(self):
        self.closed = True


class ExplodingResponse(FakeResponse):
    def read(self, amount=-1):
        raise OSError("access-secret must not escape")


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, *, headers, body, timeout):
        self.calls.append((method, url, dict(headers), body, timeout))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


class GmailAdapterTest(unittest.TestCase):
    def make_adapter(self, responses, **kwargs):
        client = FakeHttp(responses)
        return GmailAdapter(gmail_account(), http_client=client, **kwargs), client

    def test_default_registry_routes_gmail_without_server_configuration(self):
        self.assertIsInstance(build_default_registry().adapter_for(gmail_account()), GmailAdapter)

    def test_requires_oauth2_access_token(self):
        for auth in ({"type": "PASSWORD", "secret": "x"}, {"type": "OAUTH2"}):
            value = account(provider="gmail")
            value["auth"] = auth
            value.pop("server", None)
            with self.subTest(auth=auth), self.assertRaises(MailRuntimeError) as raised:
                GmailAdapter(AccountConfig.from_mapping(value))
            self.assertEqual(ErrorCode.AUTH_REQUIRED, raised.exception.code)

    def test_list_fetches_metadata_and_wraps_cursor(self):
        responses = [
            FakeResponse(200, {"messages": [{"id": "g123"}], "nextPageToken": "page-safe"}),
            FakeResponse(200, full_message()),
        ]
        adapter, client = self.make_adapter(responses)
        page = adapter.list_messages(ListRequest(limit=5))
        self.assertEqual("g123", page.items[0].message_id)
        self.assertEqual("测试主题", page.items[0].subject)
        self.assertTrue(page.items[0].has_attachments)
        self.assertTrue(page.next_cursor.startswith("gc1."))
        first = urlsplit(client.calls[0][1])
        self.assertEqual("https", first.scheme)
        self.assertEqual("gmail.googleapis.com", first.hostname)
        self.assertEqual({"labelIds": ["INBOX"], "maxResults": ["5"]}, parse_qs(first.query))
        self.assertEqual("Bearer access-secret", client.calls[0][2]["Authorization"])
        self.assertTrue(all(response.closed for response in responses))

    def test_cursor_is_bound_and_raw_query_injection_is_rejected(self):
        adapter, _ = self.make_adapter([])
        for cursor in ("pageToken=x&maxResults=999", "gc1.bad", "m1.abcdefgh"):
            with self.subTest(cursor=cursor), self.assertRaises(MailRuntimeError) as raised:
                adapter.list_messages(ListRequest(cursor=cursor))
            self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_wrapped_cursor_safely_round_trips_opaque_gmail_page_token(self):
        adapter, _ = self.make_adapter([FakeResponse(200, {"messages": [], "nextPageToken": "x=y+/"})])
        cursor = adapter.list_messages(ListRequest()).next_cursor
        adapter, client = self.make_adapter([FakeResponse(200, {"messages": []})])
        adapter.list_messages(ListRequest(cursor=cursor))
        self.assertEqual(["x=y+/"], parse_qs(urlsplit(client.calls[0][1]).query)["pageToken"])

    def test_cursor_is_bound_to_account_operation_and_canonical_search(self):
        adapter, _ = self.make_adapter([FakeResponse(200, {"messages": [], "nextPageToken": "next-list"})])
        list_cursor = adapter.list_messages(ListRequest()).next_cursor
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.search_messages(SearchRequest("from:a@example.test", cursor=list_cursor))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

        value = account(account_id="2002", provider="gmail")
        value["auth"] = {"type": "OAUTH2", "accessToken": "other-token"}
        value.pop("server", None)
        other = GmailAdapter(AccountConfig.from_mapping(value), http_client=FakeHttp([]))
        with self.assertRaises(MailRuntimeError) as raised:
            other.list_messages(ListRequest(cursor=list_cursor))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

        adapter, _ = self.make_adapter([FakeResponse(200, {"messages": [], "nextPageToken": "next-search"})])
        search_cursor = adapter.search_messages(SearchRequest('subject:"one"')).next_cursor
        adapter, _ = self.make_adapter([])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.search_messages(SearchRequest('subject:"two"', cursor=search_cursor))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_get_recursively_decodes_mime_and_binds_attachment_locator(self):
        nested = full_message()
        nested["payload"]["parts"] = [{
            "partId": "outer", "mimeType": "multipart/alternative", "filename": "", "headers": [],
            "body": {"size": 0}, "parts": nested["payload"]["parts"],
        }]
        adapter, _ = self.make_adapter([FakeResponse(200, nested)])
        message = adapter.get_message("g123")
        self.assertEqual("plain body", message.text)
        self.assertEqual("<p>html body</p>", message.html)
        self.assertEqual("report.pdf", message.attachments[0].filename)
        self.assertTrue(message.attachments[0].attachment_id.startswith("ga1."))

    def test_get_rejects_upstream_attachment_filename_that_could_escape_sink(self):
        payload = full_message()
        payload["payload"]["parts"][2]["filename"] = "../outside.pdf"
        adapter, _ = self.make_adapter([FakeResponse(200, payload)])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_get_rejects_malformed_upstream_mime_type(self):
        payload = full_message()
        payload["payload"]["parts"][2]["mimeType"] = "application/pdf\r\nX-Leak: access-secret"
        adapter, _ = self.make_adapter([FakeResponse(200, payload)])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_mime_depth_and_invalid_base64_are_bounded(self):
        payload = full_message()
        node = payload["payload"]
        for index in range(40):
            child = {"partId": str(index), "mimeType": "multipart/mixed", "filename": "", "headers": [], "body": {"size": 0}, "parts": []}
            node["parts"] = [child]
            node = child
        adapter, _ = self.make_adapter([FakeResponse(200, payload)])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_get_fetches_external_plain_body_without_exposing_it_as_attachment(self):
        payload = full_message(attachment=False)
        plain = payload["payload"]["parts"][0]
        plain["body"] = {"attachmentId": "body-42", "size": 10}
        adapter, client = self.make_adapter([
            FakeResponse(200, payload),
            FakeResponse(200, {"size": 10, "data": encoded(b"plain body")}),
        ])
        message = adapter.get_message("g123")
        self.assertEqual("plain body", message.text)
        self.assertEqual((), message.attachments)
        self.assertIn("/messages/g123/attachments/body-42", client.calls[1][1])

    def test_get_rejects_reused_external_body_attachment_id(self):
        payload = full_message(attachment=False)
        for part in payload["payload"]["parts"]:
            part["body"] = {"attachmentId": "body-42", "size": 10}
        adapter, _ = self.make_adapter([
            FakeResponse(200, payload),
            FakeResponse(200, {"size": 10, "data": encoded(b"plain body")}),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_external_body_404_maps_to_message_not_found(self):
        payload = full_message(attachment=False)
        payload["payload"]["parts"][0]["body"] = {"attachmentId": "body-42", "size": 10}
        adapter, _ = self.make_adapter([FakeResponse(200, payload), FakeResponse(404, {})])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.MESSAGE_NOT_FOUND, raised.exception.code)

    def test_external_text_fetch_is_capped_to_first_plain_and_html(self):
        payload = full_message(attachment=False)
        payload["payload"]["parts"] = []
        body_responses = []
        for index in range(100):
            mime_type = "text/plain" if index % 2 == 0 else "text/html"
            body = b"first plain" if index == 0 else (b"<p>first html</p>" if index == 1 else b"unused body")
            payload["payload"]["parts"].append({
                "partId": str(index),
                "mimeType": mime_type,
                "filename": "",
                "headers": [{"name": "Content-Type", "value": mime_type + "; charset=utf-8"}],
                "body": {"attachmentId": f"body-{index}", "size": len(body)},
            })
            if index < 2:
                body_responses.append(FakeResponse(200, {"size": len(body), "data": encoded(body)}))
        responses = [FakeResponse(200, payload), *body_responses]
        adapter, client = self.make_adapter(responses)
        message = adapter.get_message("g123")
        self.assertEqual("first plain", message.text)
        self.assertEqual("<p>first html</p>", message.html)
        self.assertEqual(3, len(client.calls))

        payload = full_message(attachment=False)
        payload["payload"]["parts"][0]["body"]["data"] = "%%%"
        adapter, _ = self.make_adapter([FakeResponse(200, payload)])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_search_compiles_structured_query_with_encoding(self):
        adapter, client = self.make_adapter([FakeResponse(200, {"messages": []})])
        adapter.search_messages(SearchRequest('from:a@example.test subject:"hello world" text:"x\\\"y" after:2026-08-01 before:2026-09-01 is:unread has:attachment'))
        query = parse_qs(urlsplit(client.calls[0][1]).query)["q"][0]
        self.assertIn('from:"a@example.test"', query)
        self.assertIn('subject:"hello world"', query)
        self.assertIn('"x\\\"y"', query)
        self.assertIn("after:2026/08/01", query)
        self.assertIn("is:unread", query)
        self.assertNotIn("trash:true", query)
        self.assertIn("maxResults=20", urlsplit(client.calls[0][1]).query)

    def test_search_rejects_operators_controls_and_overlong_values(self):
        adapter, _ = self.make_adapter([])
        for query in ('{from:a@example.test}', 'from:a@example.test\ntrash:true', 'larger:10M', "text:" + "a" * 4100):
            with self.subTest(query=query[:30]), self.assertRaises(MailRuntimeError) as raised:
                adapter.search_messages(SearchRequest(query))
            self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_attachment_requires_locator_bound_to_message_and_streams_to_sink(self):
        metadata_adapter, _ = self.make_adapter([FakeResponse(200, full_message())])
        locator = metadata_adapter.get_message("g123").attachments[0].attachment_id
        adapter, client = self.make_adapter([FakeResponse(200, {"size": 7, "data": encoded(b"PDFDATA")})])
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink:
                result = adapter.download_attachment(AttachmentRequest("g123", locator), sink)
            self.assertEqual(b"PDFDATA", (workspace / "downloads" / "report.pdf").read_bytes())
        self.assertIn("/messages/g123/attachments/att-77", client.calls[0][1])

        adapter, _ = self.make_adapter([])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.download_attachment(AttachmentRequest("different", locator), object())
        self.assertEqual(ErrorCode.ATTACHMENT_NOT_FOUND, raised.exception.code)

    def test_send_includes_rfc5322_bcc_so_gmail_can_deliver_it(self):
        adapter, client = self.make_adapter([FakeResponse(200, {"id": "sent-1", "threadId": "thread-new"})])
        draft = Draft.from_mapping({
            "to": ["To <to@example.test>"], "cc": ["cc@example.test"], "bcc": ["hidden@example.test"],
            "subject": "hello", "text": "body",
        }, require_recipients=True)
        result = adapter.send_message(draft)
        self.assertEqual("sent-1", result.message_id)
        request = json.loads(client.calls[0][3])
        raw = base64.urlsafe_b64decode(request["raw"] + "=" * (-len(request["raw"]) % 4))
        self.assertIn(b"To:", raw)
        self.assertIn(b"Cc:", raw)
        uploaded = BytesParser(policy=policy.default).parsebytes(raw)
        self.assertEqual("hidden@example.test", str(uploaded["Bcc"]))
        self.assertEqual(("to@example.test", "cc@example.test", "hidden@example.test"), result.accepted)

    def test_reply_uses_original_thread_and_safe_headers(self):
        adapter, client = self.make_adapter([
            FakeResponse(200, full_message()),
            FakeResponse(200, {"id": "reply-1", "threadId": "thread-9"}),
        ])
        result = adapter.reply_message("g123", Draft.from_mapping({"text": "reply body"}, require_recipients=False))
        self.assertEqual("reply-1", result.message_id)
        sent = json.loads(client.calls[1][3])
        self.assertEqual("thread-9", sent["threadId"])
        raw = base64.urlsafe_b64decode(sent["raw"] + "=" * (-len(sent["raw"]) % 4))
        self.assertIn(b"In-Reply-To: <original@example.test>", raw)
        self.assertIn(b"References: <root@example.test> <original@example.test>", raw)
        self.assertIn(b"Subject: Re:", raw)
        self.assertIn(b"To: reply@example.test", raw)

    def test_reply_rejects_malformed_message_id_and_references(self):
        for header, value in (
            ("Message-ID", "<missing-at>"),
            ("Message-ID", "<a@example.test><b@example.test>"),
            ("Message-ID", "<a..b@example.test>"),
            ("References", "<root@example.test> not-a-message-id"),
        ):
            payload = full_message()
            for item in payload["payload"]["headers"]:
                if item["name"] == header:
                    item["value"] = value
            adapter, _ = self.make_adapter([FakeResponse(200, payload)])
            with self.subTest(header=header, value=value), self.assertRaises(MailRuntimeError) as raised:
                adapter.reply_message("g123", Draft.from_mapping({"text": "reply"}, require_recipients=False))
            self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_reply_requires_send_response_to_match_original_thread(self):
        adapter, _ = self.make_adapter([
            FakeResponse(200, full_message()),
            FakeResponse(200, {"id": "reply-1", "threadId": "different-thread"}),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.reply_message("g123", Draft.from_mapping({"text": "reply"}, require_recipients=False))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_trash_endpoint_is_not_permanent_delete(self):
        adapter, client = self.make_adapter([FakeResponse(200, {"id": "g123", "threadId": "thread-9"})])
        result = adapter.delete_message("g123")
        self.assertEqual("trash", result.moved_to)
        self.assertEqual("POST", client.calls[0][0])
        self.assertTrue(client.calls[0][1].endswith("/messages/g123/trash"))
        self.assertNotEqual("DELETE", client.calls[0][0])

    def test_status_mapping_is_safe_and_closes_response(self):
        mapping = {
            401: ErrorCode.AUTH_EXPIRED, 403: ErrorCode.PERMISSION_DENIED,
            404: ErrorCode.MESSAGE_NOT_FOUND, 429: ErrorCode.RATE_LIMITED, 503: ErrorCode.UPSTREAM_UNAVAILABLE,
        }
        for status, code in mapping.items():
            responses = [FakeResponse(status, {"error": {"message": "access-secret leaked"}}) for _ in range(3)]
            adapter, _ = self.make_adapter(responses, sleep=lambda _delay: None, jitter=lambda: 0)
            with self.subTest(status=status), self.assertRaises(MailRuntimeError) as raised:
                adapter.get_message("g123")
            self.assertEqual(code, raised.exception.code)
            self.assertNotIn("access-secret", str(raised.exception))
            used = 3 if status in {429, 503} else 1
            self.assertTrue(all(response.closed for response in responses[:used]))

    def test_403_reason_maps_rate_limits_and_retries_only_short_term_reads(self):
        short = {"error": {"status": "RESOURCE_EXHAUSTED", "errors": [{"reason": "userRateLimitExceeded"}]}}
        responses = [FakeResponse(403, short, {"Retry-After": "1"}), FakeResponse(200, full_message())]
        sleeps = []
        adapter, client = self.make_adapter(responses, sleep=sleeps.append, jitter=lambda: 0)
        self.assertEqual("g123", adapter.get_message("g123").message_id)
        self.assertEqual(2, len(client.calls))
        self.assertEqual([1.0], sleeps)
        self.assertTrue(all(response.closed for response in responses))

        for reason in ("dailyLimitExceeded", "quotaExceeded"):
            response = FakeResponse(403, {"error": {"errors": [{"reason": reason}]}})
            adapter, client = self.make_adapter([response])
            with self.subTest(reason=reason), self.assertRaises(MailRuntimeError) as raised:
                adapter.get_message("g123")
            self.assertEqual(ErrorCode.RATE_LIMITED, raised.exception.code)
            self.assertEqual(1, len(client.calls))
            self.assertTrue(response.closed)

        response = FakeResponse(403, {"error": {"errors": [{"reason": "insufficientPermissions"}]}})
        adapter, _ = self.make_adapter([response])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.PERMISSION_DENIED, raised.exception.code)

    def test_write_does_not_retry_short_term_403_rate_reason(self):
        response = FakeResponse(403, {"error": {"errors": [{"reason": "rateLimitExceeded"}]}})
        adapter, client = self.make_adapter([response])
        draft = Draft.from_mapping({"to": ["to@example.test"], "text": "body"}, require_recipients=True)
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(draft)
        self.assertEqual(ErrorCode.RATE_LIMITED, raised.exception.code)
        self.assertEqual(1, len(client.calls))

    def test_retry_only_applies_to_idempotent_reads_and_is_bounded(self):
        sleeps = []
        adapter, client = self.make_adapter([
            FakeResponse(429, {}, {"Retry-After": "1"}), FakeResponse(200, full_message())
        ], sleep=sleeps.append, jitter=lambda: 0)
        self.assertEqual("g123", adapter.get_message("g123").message_id)
        self.assertEqual([1.0], sleeps)
        self.assertEqual(2, len(client.calls))

        adapter, client = self.make_adapter([FakeResponse(503, {})])
        draft = Draft.from_mapping({"to": ["to@example.test"], "text": "body"}, require_recipients=True)
        with self.assertRaises(MailRuntimeError):
            adapter.send_message(draft)
        self.assertEqual(1, len(client.calls))

    def test_retry_after_is_capped_and_clock_is_injectable(self):
        sleeps = []
        fixed = datetime(2026, 8, 31, 0, 0, tzinfo=timezone.utc)
        adapter, _ = self.make_adapter([
            FakeResponse(429, {}, {"Retry-After": "99"}), FakeResponse(200, full_message())
        ], sleep=sleeps.append, jitter=lambda: 0, clock=lambda: fixed)
        adapter.get_message("g123")
        self.assertEqual([5.0], sleeps)

    def test_attachment_invalid_base64_removes_partial_output(self):
        metadata_adapter, _ = self.make_adapter([FakeResponse(200, full_message())])
        locator = metadata_adapter.get_message("g123").attachments[0].attachment_id
        adapter, _ = self.make_adapter([FakeResponse(200, {"size": 7, "data": "%%%"})])
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink:
                with self.assertRaises(MailRuntimeError) as raised:
                    adapter.download_attachment(AttachmentRequest("g123", locator), sink)
            self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
            self.assertFalse((workspace / "downloads" / "report.pdf").exists())

    def test_inline_attachment_is_discovered_and_downloaded_after_message_revalidation(self):
        payload = inline_attachment_message()
        metadata_adapter, _ = self.make_adapter([FakeResponse(200, payload)])
        attachment = metadata_adapter.get_message("g123").attachments[0]
        self.assertEqual("inline.pdf", attachment.filename)

        adapter, client = self.make_adapter([FakeResponse(200, payload)])
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink:
                adapter.download_attachment(AttachmentRequest("g123", attachment.attachment_id), sink)
            self.assertEqual(b"PDFDATA", (workspace / "downloads" / "inline.pdf").read_bytes())
        self.assertIn("/messages/g123", client.calls[0][1])
        self.assertIn("format=full", client.calls[0][1])
        self.assertNotIn("/attachments/", client.calls[0][1])

    def test_inline_attachment_rejects_oversize_invalid_base64_and_cleans_sink(self):
        payload = inline_attachment_message()
        payload["payload"]["parts"][-1]["body"]["size"] = 25 * 1024 * 1024 + 1
        adapter, _ = self.make_adapter([FakeResponse(200, payload)])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

        good = inline_attachment_message()
        metadata_adapter, _ = self.make_adapter([FakeResponse(200, good)])
        locator = metadata_adapter.get_message("g123").attachments[0].attachment_id
        invalid = inline_attachment_message()
        invalid["payload"]["parts"][-1]["body"]["data"] = "%%%"
        adapter, _ = self.make_adapter([FakeResponse(200, invalid)])
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink:
                with self.assertRaises(MailRuntimeError) as raised:
                    adapter.download_attachment(AttachmentRequest("g123", locator), sink)
            self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
            self.assertFalse((workspace / "downloads" / "inline.pdf").exists())

    def test_inline_attachment_locator_rejects_changed_missing_and_cross_message_parts(self):
        good = inline_attachment_message()
        metadata_adapter, _ = self.make_adapter([FakeResponse(200, good)])
        locator = metadata_adapter.get_message("g123").attachments[0].attachment_id
        changed = inline_attachment_message()
        changed["payload"]["parts"][-1]["filename"] = "changed.pdf"
        missing = full_message(attachment=False)
        for payload in (changed, missing):
            adapter, _ = self.make_adapter([FakeResponse(200, payload)])
            with tempfile.TemporaryDirectory() as temp:
                workspace = Path(temp).resolve() / "workspace"
                workspace.mkdir(mode=0o700)
                with AttachmentSink(workspace, workspace / "downloads") as sink:
                    with self.assertRaises(MailRuntimeError) as raised:
                        adapter.download_attachment(AttachmentRequest("g123", locator), sink)
            self.assertEqual(ErrorCode.ATTACHMENT_NOT_FOUND, raised.exception.code)

        adapter, _ = self.make_adapter([])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.download_attachment(AttachmentRequest("other-message", locator), object())
        self.assertEqual(ErrorCode.ATTACHMENT_NOT_FOUND, raised.exception.code)

        tampered = locator[:-1] + ("A" if locator[-1] != "A" else "B")
        adapter, _ = self.make_adapter([])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.download_attachment(AttachmentRequest("g123", tampered), object())
        self.assertIn(raised.exception.code, {ErrorCode.ATTACHMENT_NOT_FOUND, ErrorCode.INVALID_REQUEST})

    def test_timeout_response_limit_and_content_type_are_upstream_errors(self):
        for response in (
            socket.timeout("access-secret"),
            FakeResponse(200, b"x" * (2 * 1024 * 1024), {"Content-Type": "application/json"}),
            FakeResponse(200, b"{}", {"Content-Type": "text/html"}),
        ):
            adapter, _ = self.make_adapter([response])
            with self.subTest(response=type(response).__name__), self.assertRaises(MailRuntimeError) as raised:
                adapter.get_message("g123")
            self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

        response = ExplodingResponse(200, {})
        adapter, _ = self.make_adapter([response])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("g123")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertNotIn("access-secret", str(raised.exception))
        self.assertTrue(response.closed)

    def test_urllib_client_installs_explicit_tls_context_and_rejects_redirects(self):
        tls_context = object()
        fake_opener = object()
        with patch("mail_runtime.gmail.build_opener", return_value=fake_opener) as builder:
            client = UrllibGmailHttpClient(ssl_context_factory=lambda: tls_context)
        self.assertIs(fake_opener, client._opener)
        handlers = builder.call_args.args
        self.assertTrue(any(isinstance(handler, _NoRedirect) for handler in handlers))
        https = next(handler for handler in handlers if isinstance(handler, HTTPSHandler))
        self.assertIs(tls_context, https._context)
        redirect = _NoRedirect()
        self.assertIsNone(redirect.redirect_request(None, None, 302, "redirect", {}, "https://evil.test"))

    def test_invalid_message_id_and_cross_adapter_locator_are_rejected(self):
        adapter, _ = self.make_adapter([])
        for message_id in ("m1.abcdefgh", "x/y", "x?y", "", "a" * 129):
            with self.subTest(message_id=message_id[:20]), self.assertRaises(MailRuntimeError) as raised:
                adapter.get_message(message_id)
            self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_probe_uses_profile_metadata_and_never_messages(self):
        adapter, client = self.make_adapter([FakeResponse(200, {})])
        adapter.probe_connection()
        self.assertIn("/profile", client.calls[0][1])
        self.assertNotIn("/messages", client.calls[0][1])


if __name__ == "__main__":
    unittest.main()
