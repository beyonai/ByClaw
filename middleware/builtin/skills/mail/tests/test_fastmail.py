from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from _support import account
from mail_runtime.fastmail_jmap import FastmailJmapAdapter, UrllibFastmailHttpClient, _NoRedirect, _token
from mail_runtime.io_security import AttachmentSink
from mail_runtime.models import AccountConfig, AttachmentRequest, Draft, ErrorCode, ListRequest, MailRuntimeError, SearchRequest
from mail_runtime.registry import build_default_registry


CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
SUBMISSION = "urn:ietf:params:jmap:submission"


def fastmail_account(token="fm-secret"):
    value = account(provider="fastmail")
    value["auth"] = {"type": "API_TOKEN", "secret": token}
    value.pop("server", None)
    return AccountConfig.from_mapping(value)


def session(**overrides):
    value = {
        "capabilities": {
            CORE: {"maxSizeUpload": 25_000_000, "maxSizeRequest": 10_000_000, "maxCallsInRequest": 16, "maxObjectsInGet": 100, "maxObjectsInSet": 100},
            MAIL: {},
            SUBMISSION: {},
        },
        "accounts": {"acc-1": {"accountCapabilities": {MAIL: {}, SUBMISSION: {}}}},
        "primaryAccounts": {MAIL: "acc-1", SUBMISSION: "acc-1"},
        "apiUrl": "https://api.fastmail.com/jmap/api/",
        "uploadUrl": "https://api.fastmail.com/jmap/upload/{accountId}/",
        "downloadUrl": "https://www.fastmailusercontent.com/jmap/download/{accountId}/{blobId}/{name}?type={type}",
    }
    value.update(overrides)
    return value


class Response:
    def __init__(self, status, payload, content_type="application/json", headers=None):
        self.status = status
        self.body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.headers = {"Content-Type": content_type, "Content-Length": str(len(self.body)), **(headers or {})}
        self.offset = 0
        self.closed = False

    def read(self, amount=-1):
        if amount < 0:
            amount = len(self.body) - self.offset
        chunk = self.body[self.offset:self.offset + amount]
        self.offset += len(chunk)
        return chunk

    def close(self):
        self.closed = True


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, *, headers, body, timeout):
        self.calls.append((method, url, dict(headers), body))
        if not self.responses:
            raise AssertionError("unexpected HTTP call")
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        if callable(response):
            return response(method, url, headers, body)
        return response


def methods(*responses):
    return Response(200, {"methodResponses": list(responses), "sessionState": "s1"})


MAILBOXES = ("Mailbox/get", {"accountId": "acc-1", "state": "mb1", "list": [
    {"id": "inbox", "role": "inbox", "name": "Inbox"},
    {"id": "trash", "role": "trash", "name": "Trash"},
    {"id": "drafts", "role": "drafts", "name": "Drafts"},
    {"id": "sent", "role": "sent", "name": "Sent"},
]}, "m1")


EMAIL = {
    "id": "e1", "blobId": "b1", "threadId": "t1", "mailboxIds": {"inbox": True},
    "subject": "Hello", "preview": "preview", "receivedAt": "2026-08-31T00:00:00Z",
    "from": [{"name": "Sender", "email": "sender@example.test"}],
    "to": [{"name": "Person", "email": "person@example.com"}],
    "messageId": ["orig@example.test"], "inReplyTo": [], "references": ["root@example.test"],
    "textBody": [{"partId": "p1", "blobId": "tb1", "type": "text/plain", "size": 4}],
    "htmlBody": [], "bodyValues": {"p1": {"value": "body", "isEncodingProblem": False, "isTruncated": False}},
    "attachments": [{"blobId": "att1", "name": "report.pdf", "type": "application/pdf", "size": 7}],
}


class FastmailJmapTest(unittest.TestCase):
    def test_probe_validates_session_without_email_methods(self):
        http = FakeHttp([Response(200, session())])
        FastmailJmapAdapter(fastmail_account(), http_client=http).probe_connection()
        self.assertEqual(1, len(http.calls))
        self.assertEqual("https://api.fastmail.com/jmap/session", http.calls[0][1])

    def test_real_client_wires_injected_tls_context_and_no_redirect_handler(self):
        context = object()
        opener = object()
        with patch("mail_runtime.fastmail_jmap.build_opener", return_value=opener) as build:
            client = UrllibFastmailHttpClient(lambda: context)
        self.assertIs(opener, client._opener)
        handlers = build.call_args.args
        self.assertTrue(any(isinstance(item, _NoRedirect) for item in handlers))
        https = next(item for item in handlers if item.__class__.__name__ == "HTTPSHandler")
        self.assertIs(context, https._context)

    def test_real_http_policy_refuses_redirects_and_responses_are_closed(self):
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://evil.example"))
        session_response = Response(200, session())
        mailbox_response = methods(MAILBOXES)
        query_response = methods(("Email/query", {"accountId": "acc-1", "queryState": "q", "position": 0, "ids": [], "total": 0}, "m2"))
        FastmailJmapAdapter(fastmail_account(), http_client=FakeHttp([
            session_response, mailbox_response, query_response,
        ])).list_messages(ListRequest())
        self.assertTrue(session_response.closed)
        self.assertTrue(mailbox_response.closed)
        self.assertTrue(query_response.closed)

    def test_registry_routes_fastmail_api_token(self):
        self.assertIsInstance(build_default_registry().adapter_for(fastmail_account()), FastmailJmapAdapter)

    def test_session_is_fixed_bearer_no_redirect_and_rejects_ssrf(self):
        http = FakeHttp([Response(200, session(apiUrl="https://evil.example/jmap"))])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http)
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.list_messages(ListRequest())
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        method, url, headers, _body = http.calls[0]
        self.assertEqual(("GET", "https://api.fastmail.com/jmap/session"), (method, url))
        self.assertEqual("Bearer fm-secret", headers["Authorization"])
        bad_port = FakeHttp([Response(200, session(apiUrl="https://api.fastmail.com:bad/jmap"))])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=bad_port).list_messages(ListRequest())
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_list_get_search_and_cursor_filter_binding(self):
        email_get = ("Email/get", {"accountId": "acc-1", "state": "e1", "list": [EMAIL], "notFound": []}, "m3")
        http = FakeHttp([
            Response(200, session()), methods(MAILBOXES),
            methods(("Email/query", {"accountId": "acc-1", "queryState": "q1", "canCalculateChanges": True, "position": 0, "ids": ["e1"], "total": 2}, "m2")),
            methods(email_get),
            methods(("Email/get", {"accountId": "acc-1", "state": "e1", "list": [EMAIL], "notFound": []}, "m1")),
            methods(("Email/query", {"accountId": "acc-1", "queryState": "q2", "canCalculateChanges": True, "position": 0, "ids": ["e1"], "total": 1}, "m1")),
            methods(email_get),
        ])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http)
        page = adapter.list_messages(ListRequest(limit=1))
        self.assertEqual("e1", page.items[0].message_id)
        self.assertIsNotNone(page.next_cursor)
        content = adapter.get_message("e1")
        self.assertEqual("body", content.text)
        searched = adapter.search_messages(SearchRequest("from:sender@example.test subject:Hello has:attachment", 10))
        self.assertEqual("e1", searched.items[0].message_id)
        query_body = json.loads(http.calls[5][3])
        filter_value = query_body["methodCalls"][0][1]["filter"]
        self.assertEqual("sender@example.test", filter_value["from"])
        self.assertEqual("Hello", filter_value["subject"])
        self.assertTrue(filter_value["hasAttachment"])
        with self.assertRaises(MailRuntimeError):
            adapter.search_messages(SearchRequest("subject:different", 10, page.next_cursor))

    def test_attachment_locator_download_is_context_bound_and_streamed(self):
        email_get = ("Email/get", {"accountId": "acc-1", "state": "e1", "list": [EMAIL], "notFound": []}, "m1")
        http = FakeHttp([Response(200, session()), methods(email_get)])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http)
        content = adapter.get_message("e1")
        locator = content.attachments[0].attachment_id
        http.responses.extend([methods(email_get), Response(200, b"PDFDATA", "application/pdf")])
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            os.chmod(workspace, 0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink:
                result = adapter.download_attachment(AttachmentRequest("e1", locator), sink)
                self.assertEqual(7, result.size)
        self.assertEqual("www.fastmailusercontent.com", urlsplit(http.calls[-1][1]).hostname)
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.download_attachment(AttachmentRequest("other", locator), None)
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

        http.responses.extend([methods(email_get), Response(404, b"missing", "text/plain")])
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root).resolve() / "workspace"; workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink, self.assertRaises(MailRuntimeError) as raised:
                adapter.download_attachment(AttachmentRequest("e1", locator), sink)
        self.assertEqual(ErrorCode.ATTACHMENT_NOT_FOUND, raised.exception.code)

    def test_send_uses_upload_import_identity_submission_and_bcc_only_in_envelope(self):
        http = FakeHttp([
            Response(200, session()),
            lambda _method, _url, _headers, body: Response(201, {"accountId": "acc-1", "blobId": "raw1", "type": "message/rfc822", "size": len(body)}),
            methods(MAILBOXES),
            methods(("Email/import", {"accountId": "acc-1", "newState": "s2", "created": {"draft": {"id": "draft-id", "blobId": "raw1", "threadId": "t", "size": 123}}}, "m1")),
            methods(("Identity/get", {"accountId": "acc-1", "state": "i", "list": [{"id": "ident1", "email": "person@example.com"}], "notFound": []}, "m1")),
            methods(
                ("EmailSubmission/set", {"accountId": "acc-1", "newState": "y", "created": {"submit": {"id": "sub1"}}, "notCreated": None}, "m1"),
                ("Email/set", {"accountId": "acc-1", "newState": "e3", "updated": {"draft-id": None}}, "m1"),
            ),
        ])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http)
        result = adapter.send_message(Draft(to=("to@example.test",), bcc=("hidden@example.test",), subject="S", text="B"))
        self.assertEqual("draft-id", result.message_id)
        self.assertEqual((), result.accepted)
        self.assertEqual((), result.rejected)
        raw = http.calls[1][3]
        self.assertNotIn(b"Bcc:", raw)
        submission = json.loads(http.calls[5][3])["methodCalls"][0][1]["create"]["submit"]
        self.assertEqual({"to@example.test", "hidden@example.test"}, {item["email"] for item in submission["envelope"]["rcptTo"]})

    def test_delete_moves_to_trash_never_destroy_and_is_idempotent(self):
        email = {**EMAIL, "mailboxIds": {"inbox": True}}
        http = FakeHttp([
            Response(200, session()), methods(MAILBOXES),
            methods(("Email/get", {"accountId": "acc-1", "state": "e1", "list": [email], "notFound": []}, "m1")),
            methods(("Email/set", {"accountId": "acc-1", "newState": "e2", "updated": {"e1": None}}, "m1")),
        ])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http)
        result = adapter.delete_message("e1")
        self.assertEqual("trash", result.moved_to)
        payload = json.loads(http.calls[-1][3])["methodCalls"][0][1]
        self.assertNotIn("destroy", payload)
        self.assertEqual({"trash": True}, payload["update"]["e1"]["mailboxIds"])

        mixed = {**EMAIL, "mailboxIds": {"inbox": True, "trash": True}}
        mixed_http = FakeHttp([
            Response(200, session()), methods(MAILBOXES),
            methods(("Email/get", {"accountId": "acc-1", "state": "e1", "list": [mixed], "notFound": []}, "m1")),
            methods(("Email/set", {"accountId": "acc-1", "oldState": "e1", "newState": "e2", "updated": {"e1": None}, "notUpdated": {}}, "m1")),
        ])
        FastmailJmapAdapter(fastmail_account(), http_client=mixed_http).delete_message("e1")
        mixed_payload = json.loads(mixed_http.calls[-1][3])["methodCalls"][0][1]
        self.assertEqual({"trash": True}, mixed_payload["update"]["e1"]["mailboxIds"])

    def test_reply_uses_reply_to_headers_and_submission_envelope(self):
        original = {**EMAIL, "replyTo": [{"name": "Reply", "email": "reply@example.test"}]}
        http = FakeHttp([
            Response(200, session()),
            methods(("Email/get", {"accountId": "acc-1", "state": "e1", "list": [original], "notFound": []}, "m1")),
            lambda _method, _url, _headers, body: Response(201, {"accountId": "acc-1", "blobId": "raw1", "type": "message/rfc822", "size": len(body)}),
            methods(MAILBOXES),
            methods(("Email/import", {"accountId": "acc-1", "oldState": "e1", "newState": "e2", "created": {"draft": {"id": "reply-id", "blobId": "raw1", "threadId": "t1", "size": 123}}, "notCreated": {}}, "m1")),
            methods(("Identity/get", {"accountId": "acc-1", "state": "i1", "list": [{"id": "ident1", "email": "person@example.com"}], "notFound": []}, "m1")),
            methods(
                ("EmailSubmission/set", {"accountId": "acc-1", "oldState": "s1", "newState": "s2", "created": {"submit": {"id": "sub1"}}}, "m1"),
                ("Email/set", {"accountId": "acc-1", "oldState": "e2", "newState": "e3", "updated": {"reply-id": {"keywords": {"$draft": None}}}}, "m1"),
            ),
        ])
        result = FastmailJmapAdapter(fastmail_account(), http_client=http).reply_message("e1", Draft(text="reply"))
        self.assertEqual("reply-id", result.message_id)
        raw = http.calls[2][3]
        self.assertIn(b"To: Reply <reply@example.test>", raw)
        self.assertIn(b"Subject: Re: Hello", raw)
        self.assertIn(b"In-Reply-To: <orig@example.test>", raw)
        self.assertIn(b"References: <root@example.test> <orig@example.test>", raw)

    def test_reply_rejects_malformed_upstream_message_headers_safely(self):
        malformed = {**EMAIL, "messageId": ["bad\r\nBcc: victim@example.test"]}
        http = FakeHttp([Response(200, session()), methods(("Email/get", {
            "accountId": "acc-1", "state": "e1", "list": [malformed], "notFound": [],
        }, "m1"))])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=http).reply_message("e1", Draft(text="reply"))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_session_requires_templates_and_download_honors_declared_size_limit(self):
        http = FakeHttp([Response(200, session(downloadUrl="https://www.fastmailusercontent.com/static"))])
        with self.assertRaises(MailRuntimeError):
            FastmailJmapAdapter(fastmail_account(), http_client=http).list_messages(ListRequest())

        email_get = ("Email/get", {"accountId": "acc-1", "state": "e1", "list": [EMAIL], "notFound": []}, "m1")
        http = FakeHttp([Response(200, session()), methods(email_get)])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http)
        locator = adapter.get_message("e1").attachments[0].attachment_id
        http.responses.extend([methods(email_get), Response(200, b"x", "application/pdf", {"Content-Length": str(25 * 1024 * 1024 + 1)})])
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root).resolve() / "workspace"; workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink, self.assertRaises(MailRuntimeError):
                adapter.download_attachment(AttachmentRequest("e1", locator), sink)

    def test_jmap_error_types_map_to_stable_safe_codes(self):
        expected = {
            "notFound": ErrorCode.MESSAGE_NOT_FOUND,
            "forbidden": ErrorCode.PERMISSION_DENIED,
            "rateLimit": ErrorCode.RATE_LIMITED,
            "serverFail": ErrorCode.UPSTREAM_UNAVAILABLE,
            "unknownMethod": ErrorCode.UNSUPPORTED,
        }
        for kind, code in expected.items():
            with self.subTest(kind=kind):
                http = FakeHttp([Response(200, session()), methods(("error", {"type": kind}, "m1"))])
                with self.assertRaises(MailRuntimeError) as raised:
                    FastmailJmapAdapter(fastmail_account(), http_client=http).get_message("e1")
                self.assertEqual(code, raised.exception.code)

    def test_only_session_and_download_statuses_receive_bounded_retry(self):
        http = FakeHttp([Response(503, b"busy"), Response(200, session()), methods(MAILBOXES),
                         methods(("Email/query", {"accountId": "acc-1", "queryState": "q", "position": 0, "ids": [], "total": 0}, "m2"))])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http, sleep=lambda _seconds: None)
        self.assertEqual((), adapter.list_messages(ListRequest()).items)
        self.assertEqual(["GET", "GET"], [call[0] for call in http.calls[:2]])

        post = FakeHttp([Response(200, session()), Response(503, b"busy"), methods(MAILBOXES)])
        with self.assertRaises(MailRuntimeError):
            FastmailJmapAdapter(fastmail_account(), http_client=post, sleep=lambda _seconds: None).list_messages(ListRequest())
        self.assertEqual(2, len(post.calls))

    def test_cursor_rejects_changed_query_state(self):
        email_get = ("Email/get", {"accountId": "acc-1", "state": "e1", "list": [EMAIL], "notFound": []}, "m3")
        http = FakeHttp([
            Response(200, session()), methods(MAILBOXES),
            methods(("Email/query", {"accountId": "acc-1", "queryState": "q1", "position": 0, "ids": ["e1"], "total": 2}, "m2")),
            methods(email_get),
            methods(("Email/query", {"accountId": "acc-1", "queryState": "q2", "position": 1, "ids": [], "total": 2}, "m2")),
        ])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http)
        first = adapter.list_messages(ListRequest(limit=1))
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.list_messages(ListRequest(limit=1, cursor=first.next_cursor))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_cursor_rejects_boolean_position(self):
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=FakeHttp([]))
        payload = {"a": adapter._account.account_id, "b": "binding", "o": "list",
                   "p": True, "q": "q1", "v": 1}
        payload["c"] = hashlib.sha256(json.dumps(
            payload, sort_keys=True, separators=(",", ":"),
        ).encode()).hexdigest()
        with self.assertRaises(MailRuntimeError) as raised:
            adapter._position(_token("fjc1", payload), "list", "binding")
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_every_jmap_response_requires_safe_session_state(self):
        for session_state in (None, True, "bad state"):
            with self.subTest(session_state=session_state):
                document = {"methodResponses": [("Email/get", {
                    "accountId": "acc-1", "state": "e1", "list": [EMAIL], "notFound": [],
                }, "m1")]}
                if session_state is not None:
                    document["sessionState"] = session_state
                http = FakeHttp([Response(200, session()), Response(200, document)])
                with self.assertRaises(MailRuntimeError) as raised:
                    FastmailJmapAdapter(fastmail_account(), http_client=http).get_message("e1")
                self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
                self.assertTrue(raised.exception.retryable)

    def test_email_get_batches_to_session_limit_and_requires_exact_id_partition(self):
        limited = session(); limited["capabilities"][CORE]["maxObjectsInGet"] = 1
        e2 = {**EMAIL, "id": "e2", "blobId": "b2"}
        http = FakeHttp([
            Response(200, limited),
            methods(("Email/get", {"accountId": "acc-1", "state": "s1", "list": [EMAIL], "notFound": []}, "m1")),
            methods(("Email/get", {"accountId": "acc-1", "state": "s1", "list": [e2], "notFound": []}, "m1")),
        ])
        rows = FastmailJmapAdapter(fastmail_account(), http_client=http)._email_get(["e1", "e2"])
        self.assertEqual(["e1", "e2"], [row["id"] for row in rows])
        self.assertEqual(3, len(http.calls))

        malformed = FakeHttp([Response(200, session()), methods(("Email/get", {
            "accountId": "acc-1", "state": "s1", "list": [], "notFound": [],
        }, "m1"))])
        with self.assertRaises(MailRuntimeError):
            FastmailJmapAdapter(fastmail_account(), http_client=malformed)._email_get(["e1"])

    def test_malformed_jmap_attachment_dto_is_rejected_not_silently_dropped(self):
        malformed = {**EMAIL, "attachments": ["not-an-object"]}
        http = FakeHttp([Response(200, session()), methods(("Email/get", {
            "accountId": "acc-1", "state": "e1", "list": [malformed], "notFound": [],
        }, "m1"))])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=http).get_message("e1")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_attachment_is_revalidated_against_current_message_before_download(self):
        email_get = ("Email/get", {"accountId": "acc-1", "state": "e1", "list": [EMAIL], "notFound": []}, "m1")
        changed = {**EMAIL, "attachments": [{"blobId": "different", "name": "report.pdf", "type": "application/pdf", "size": 7}]}
        changed_get = ("Email/get", {"accountId": "acc-1", "state": "e2", "list": [changed], "notFound": []}, "m1")
        http = FakeHttp([Response(200, session()), methods(email_get), methods(changed_get)])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=http)
        locator = adapter.get_message("e1").attachments[0].attachment_id
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root).resolve() / "workspace"; workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink, self.assertRaises(MailRuntimeError) as raised:
                adapter.download_attachment(AttachmentRequest("e1", locator), sink)
        self.assertEqual(ErrorCode.ATTACHMENT_NOT_FOUND, raised.exception.code)
        self.assertEqual(3, len(http.calls), "mismatched locator must not reach download URL")

    def test_search_dates_and_keywords_are_strict_structured_filters(self):
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=FakeHttp([Response(200, session())]))
        self.assertEqual({"after": "2026-08-01T00:00:00Z", "before": "2026-09-01T00:00:00Z", "hasKeyword": "$seen"},
                         adapter._search_filter("after:2026-08-01 before:2026-09-01 is:read"))
        self.assertEqual({"notKeyword": "$seen"}, adapter._search_filter("is:unread"))
        self.assertEqual({"notKeyword": "$flagged"}, adapter._search_filter("not:flagged"))
        for query in ("after:2026-02-30", "before:yesterday", "is:admin", "not:system", "is:read is:unread"):
            with self.subTest(query=query), self.assertRaises(MailRuntimeError):
                adapter._search_filter(query)

    def test_mutation_transport_unknown_is_ambiguous_and_submission_unknown_is_not_cleaned(self):
        upload_timeout = FakeHttp([Response(200, session()), TimeoutError("unknown")])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=upload_timeout).send_message(Draft(to=("to@example.test",), text="B"))
        self.assertTrue(raised.exception.ambiguous)
        self.assertFalse(raised.exception.retryable)

        submission_unknown = FakeHttp([
            Response(200, session()), lambda _method, _url, _headers, body: Response(201, {"accountId": "acc-1", "blobId": "raw1", "type": "message/rfc822", "size": len(body)}),
            methods(MAILBOXES),
            methods(("Email/import", {"accountId": "acc-1", "oldState": "e1", "newState": "e2", "created": {"draft": {"id": "draft-id", "blobId": "raw1", "threadId": "t", "size": 123}}, "notCreated": {}}, "m1")),
            methods(("Identity/get", {"accountId": "acc-1", "state": "i1", "list": [{"id": "ident1", "email": "person@example.com"}], "notFound": []}, "m1")),
            Response(503, b"busy"),
        ])
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=submission_unknown)
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(to=("to@example.test",), text="B"))
        self.assertTrue(raised.exception.ambiguous)
        self.assertEqual(6, len(submission_unknown.calls), "unknown submission must not issue cleanup")

        read_timeout = FakeHttp([Response(200, session()), TimeoutError("read unknown")])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=read_timeout).get_message("e1")
        self.assertFalse(raised.exception.ambiguous)
        self.assertTrue(raised.exception.retryable)

    def test_server_partial_fail_is_ambiguous_but_server_fail_is_conclusive(self):
        for kind, ambiguous in (("serverPartialFail", True), ("serverFail", False)):
            with self.subTest(kind=kind):
                http = FakeHttp([Response(200, session()), methods(("error", {"type": kind}, "m1"))])
                with self.assertRaises(MailRuntimeError) as raised:
                    FastmailJmapAdapter(fastmail_account(), http_client=http).get_message("e1")
                self.assertEqual(ambiguous, raised.exception.ambiguous)

    def test_stage_specific_set_error_mapping(self):
        adapter = FastmailJmapAdapter(fastmail_account(), http_client=FakeHttp([]))
        cases = (
            ("import", "invalidEmail", ErrorCode.INVALID_REQUEST),
            ("import", "tooLarge", ErrorCode.INVALID_REQUEST),
            ("import", "notFound", ErrorCode.UPSTREAM_UNAVAILABLE),
            ("submission", "forbiddenMailFrom", ErrorCode.PERMISSION_DENIED),
            ("submission", "forbiddenToSend", ErrorCode.PERMISSION_DENIED),
            ("submission", "invalidRecipients", ErrorCode.INVALID_REQUEST),
            ("submission", "rateLimit", ErrorCode.RATE_LIMITED),
        )
        for stage, kind, code in cases:
            with self.subTest(stage=stage, kind=kind):
                error = adapter._set_error(stage, {"type": kind})
                self.assertEqual(code, error.code)
                self.assertFalse(error.ambiguous)
        partial = adapter._set_error("submission", {"type": "serverPartialFail"})
        self.assertTrue(partial.ambiguous)
        self.assertFalse(partial.retryable)

    def test_conclusive_submission_failure_cleans_draft_and_cleanup_outcome_controls_ambiguity(self):
        def prefix():
            return [
                Response(200, session()),
                lambda _method, _url, _headers, body: Response(201, {"accountId": "acc-1", "blobId": "raw1", "type": "message/rfc822", "size": len(body)}),
                methods(MAILBOXES),
                methods(("Email/import", {"accountId": "acc-1", "oldState": "e1", "newState": "e2", "created": {"draft": {"id": "draft-id", "blobId": "raw1", "threadId": "t1", "size": 123}}}, "m1")),
                methods(("Identity/get", {"accountId": "acc-1", "state": "i1", "list": [{"id": "ident1", "email": "person@example.com"}], "notFound": []}, "m1")),
                methods(
                    ("EmailSubmission/set", {"accountId": "acc-1", "oldState": "s1", "newState": "s2", "notCreated": {"submit": {"type": "invalidRecipients"}}}, "m1"),
                    ("Email/set", {"accountId": "acc-1", "oldState": None, "newState": "e2"}, "m1"),
                ),
            ]
        cleanup_ok = FakeHttp(prefix() + [methods(("Email/set", {"accountId": "acc-1", "newState": "e3", "destroyed": ["draft-id"]}, "cleanup"))])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=cleanup_ok).send_message(Draft(to=("bad@example.test",), text="B"))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)
        self.assertFalse(raised.exception.ambiguous)

        cleanup_fail = FakeHttp(prefix() + [Response(503, b"busy")])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=cleanup_fail).send_message(Draft(to=("bad@example.test",), text="B"))
        self.assertTrue(raised.exception.ambiguous)

    def test_submission_method_errors_parse_before_implicit_response_and_control_cleanup(self):
        def prefix(kind):
            return [
                Response(200, session()),
                lambda _method, _url, _headers, body: Response(201, {
                    "accountId": "acc-1", "blobId": "raw1", "type": "message/rfc822", "size": len(body),
                }),
                methods(MAILBOXES),
                methods(("Email/import", {"accountId": "acc-1", "newState": "e2", "created": {
                    "draft": {"id": "draft-id", "blobId": "raw1", "threadId": "t1", "size": 123},
                }}, "m1")),
                methods(("Identity/get", {"accountId": "acc-1", "state": "i1", "list": [
                    {"id": "ident1", "email": "person@example.com"},
                ], "notFound": []}, "m1")),
                methods(("error", {"type": kind}, "m1")),
            ]

        def cleanup():
            return methods(("Email/set", {"accountId": "acc-1", "newState": "e3",
                                          "destroyed": ["draft-id"]}, "cleanup"))
        expected = {
            "serverFail": ErrorCode.UPSTREAM_UNAVAILABLE,
            "accountNotFound": ErrorCode.PERMISSION_DENIED,
            "invalidArguments": ErrorCode.UNSUPPORTED,
        }
        for kind, code in expected.items():
            with self.subTest(kind=kind, cleanup="success"):
                http = FakeHttp(prefix(kind) + [cleanup()])
                with self.assertRaises(MailRuntimeError) as raised:
                    FastmailJmapAdapter(fastmail_account(), http_client=http).send_message(
                        Draft(to=("to@example.test",), text="B"),
                    )
                self.assertEqual(code, raised.exception.code)
                self.assertFalse(raised.exception.ambiguous)
                self.assertEqual(7, len(http.calls))

            with self.subTest(kind=kind, cleanup="failure"):
                http = FakeHttp(prefix(kind) + [Response(503, b"busy")])
                with self.assertRaises(MailRuntimeError) as raised:
                    FastmailJmapAdapter(fastmail_account(), http_client=http).send_message(
                        Draft(to=("to@example.test",), text="B"),
                    )
                self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
                self.assertTrue(raised.exception.ambiguous)
                self.assertEqual(7, len(http.calls))

        partial = FakeHttp(prefix("serverPartialFail"))
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=partial).send_message(
                Draft(to=("to@example.test",), text="B"),
            )
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertTrue(raised.exception.ambiguous)
        self.assertFalse(raised.exception.retryable)
        self.assertEqual(6, len(partial.calls), "ambiguous method error must not clean up draft")

    def test_import_accepts_server_normalized_blob_id(self):
        http = FakeHttp([
            Response(200, session()),
            lambda _method, _url, _headers, body: Response(201, {"accountId": "acc-1", "blobId": "uploaded", "type": "message/rfc822", "size": len(body)}),
            methods(MAILBOXES),
            methods(("Email/import", {"accountId": "acc-1", "oldState": None, "newState": "e2", "created": {"draft": {"id": "draft-id", "blobId": "normalized", "threadId": "t1", "size": 456}}}, "m1")),
            methods(("Identity/get", {"accountId": "acc-1", "state": "i1", "list": [{"id": "ident1", "email": "person@example.com"}], "notFound": []}, "m1")),
            methods(
                ("EmailSubmission/set", {"accountId": "acc-1", "oldState": "s1", "newState": "s2", "created": {"submit": {"id": "sub1"}}}, "m1"),
                ("Email/set", {"accountId": "acc-1", "oldState": "e2", "newState": "e3", "updated": {"draft-id": None}, "notUpdated": {}}, "m1"),
            ),
        ])
        self.assertEqual("draft-id", FastmailJmapAdapter(fastmail_account(), http_client=http)
                         .send_message(Draft(to=("to@example.test",), text="B")).message_id)

    def test_import_rejects_boolean_size_as_ambiguous_upstream_shape(self):
        http = FakeHttp([
            Response(200, session()),
            lambda _method, _url, _headers, body: Response(201, {
                "accountId": "acc-1", "blobId": "uploaded", "type": "message/rfc822", "size": len(body),
            }),
            methods(MAILBOXES),
            methods(("Email/import", {"accountId": "acc-1", "oldState": None, "newState": "e2",
                                      "created": {"draft": {"id": "draft-id", "blobId": "normalized",
                                                              "threadId": "t1", "size": True}}}, "m1")),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=http).send_message(
                Draft(to=("to@example.test",), text="B"),
            )
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertTrue(raised.exception.ambiguous)

    def test_query_non_string_ids_and_bad_upstream_attachment_mime_are_safe_upstream_errors(self):
        bad_query = FakeHttp([Response(200, session()), methods(MAILBOXES), methods(("Email/query", {
            "accountId": "acc-1", "queryState": "q", "position": 0, "ids": [{"bad": True}], "total": 1,
        }, "m2"))])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=bad_query).list_messages(ListRequest())
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

        malformed = {**EMAIL, "attachments": [{"blobId": "att1", "name": "report.pdf", "type": "bad mime", "size": 7}]}
        bad_attachment = FakeHttp([Response(200, session()), methods(("Email/get", {
            "accountId": "acc-1", "state": "e1", "list": [malformed], "notFound": [],
        }, "m1"))])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=bad_attachment).get_message("e1")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_call_id_error_and_ambiguous_write_are_safe(self):
        bad_call = FakeHttp([Response(200, session()), methods(("Mailbox/get", {"list": []}, "wrong"))])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=bad_call).list_messages(ListRequest())
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

        ambiguous = FakeHttp([Response(200, session()), lambda _method, _url, _headers, body: Response(201, {"accountId": "acc-1", "blobId": "raw1", "type": "message/rfc822", "size": len(body)}), methods(MAILBOXES), Response(200, b"not-json")])
        with self.assertRaises(MailRuntimeError) as raised:
            FastmailJmapAdapter(fastmail_account(), http_client=ambiguous).send_message(Draft(to=("to@example.test",), text="B"))
        self.assertTrue(raised.exception.ambiguous)
        self.assertFalse(raised.exception.retryable)


if __name__ == "__main__":
    unittest.main()
