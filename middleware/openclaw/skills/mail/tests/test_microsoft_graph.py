from __future__ import annotations

import base64
import json
import socket
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPSHandler
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

try:
    from ._support import account
except ImportError:
    from _support import account

from mail_runtime.io_security import AttachmentSink
from mail_runtime.microsoft_graph import MicrosoftGraphAdapter, UrllibMicrosoftGraphHttpClient, _NoRedirect
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


def graph_account(token="graph-access-secret"):
    value = account(provider="microsoft-365")
    value["auth"] = {"type": "OAUTH2", "accessToken": token}
    value.pop("server", None)
    return AccountConfig.from_mapping(value)


class FakeResponse:
    def __init__(self, status, payload, headers=None):
        self.status = status
        self.headers = {"Content-Type": "application/json", **(headers or {})}
        self.body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.closed = False

    def read(self, amount=-1):
        return self.body if amount < 0 else self.body[:amount]

    def close(self):
        self.closed = True


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


def message(message_id="AAMk_opaque-1", *, attachment=False):
    return {
        "id": message_id,
        "conversationId": "conv-1",
        "parentFolderId": "inbox-id",
        "subject": "Subject",
        "bodyPreview": "Preview",
        "receivedDateTime": "2026-08-31T02:00:00Z",
        "from": {"emailAddress": {"name": "Sender", "address": "sender@example.test"}},
        "toRecipients": [{"emailAddress": {"address": "person@example.com"}}],
        "ccRecipients": [],
        "bccRecipients": [],
        "isRead": False,
        "hasAttachments": attachment,
        "body": {"contentType": "text", "content": "hello"},
        "internetMessageHeaders": [{"name": "X-Test", "value": "ok"}],
    }


class MicrosoftGraphAdapterTest(unittest.TestCase):
    def make_adapter(self, responses, **kwargs):
        client = FakeHttp(responses)
        return MicrosoftGraphAdapter(graph_account(), http_client=client, **kwargs), client

    def test_registry_routes_exact_backend_provider_without_server(self):
        self.assertIsInstance(build_default_registry().adapter_for(graph_account()), MicrosoftGraphAdapter)

    def test_requires_oauth_access_token_and_ignores_server(self):
        value = account(provider="microsoft-365")
        value["auth"] = {"type": "APP_PASSWORD", "secret": "no"}
        with self.assertRaises(MailRuntimeError) as raised:
            MicrosoftGraphAdapter(AccountConfig.from_mapping(value))
        self.assertEqual(ErrorCode.AUTH_REQUIRED, raised.exception.code)

    def test_list_uses_fixed_origin_select_order_and_bound_cursor(self):
        select = "id,subject,bodyPreview,receivedDateTime,from,hasAttachments"
        next_link = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?" + urlencode({
            "$select": select, "$orderby": "receivedDateTime desc", "$top": 2, "$skiptoken": "safe",
        })
        response = FakeResponse(200, {"value": [message()], "@odata.nextLink": next_link})
        adapter, client = self.make_adapter([response])
        page = adapter.list_messages(ListRequest(limit=2))
        self.assertEqual("AAMk_opaque-1", page.items[0].message_id)
        self.assertTrue(page.next_cursor.startswith("mc1."))
        parsed = urlsplit(client.calls[0][1])
        self.assertEqual(("https", "graph.microsoft.com"), (parsed.scheme, parsed.hostname))
        query = parse_qs(parsed.query)
        self.assertEqual(["receivedDateTime desc"], query["$orderby"])
        self.assertEqual(["2"], query["$top"])
        self.assertNotIn("body", query["$select"][0].split(","))
        self.assertEqual(select, query["$select"][0])
        self.assertTrue(response.closed)

        other = graph_account()
        object.__setattr__(other, "account_id", "other")
        other_adapter = MicrosoftGraphAdapter(other, http_client=FakeHttp([]))
        with self.assertRaises(MailRuntimeError):
            other_adapter.list_messages(ListRequest(limit=2, cursor=page.next_cursor))

    def test_cursor_rejects_malicious_nextlink(self):
        adapter, _ = self.make_adapter([FakeResponse(200, {"value": [], "@odata.nextLink": "https://evil.test/steal"})])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.list_messages(ListRequest())
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_cursor_rejects_nextlink_that_changes_canonical_search(self):
        next_link = (
            "https://graph.microsoft.com/v1.0/me/messages?%24search=from%3Aattacker%40evil.test&"
            "%24select=id&%24top=20&%24skiptoken=safe"
        )
        adapter, _ = self.make_adapter([FakeResponse(200, {"value": [], "@odata.nextLink": next_link})])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.search_messages(SearchRequest("from:sender@example.test"))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_cursor_rejects_nextlink_that_omits_canonical_query(self):
        next_link = "https://graph.microsoft.com/v1.0/me/messages?%24skiptoken=safe"
        adapter, _ = self.make_adapter([FakeResponse(200, {"value": [], "@odata.nextLink": next_link})])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.search_messages(SearchRequest("from:sender@example.test"))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_get_parses_body_recipients_and_file_attachment_locator(self):
        attachments = {"value": [{
            "@odata.type": "#microsoft.graph.fileAttachment", "id": "att_1", "name": "report.pdf",
            "contentType": "application/pdf", "size": 7, "isInline": False,
        }]}
        adapter, _ = self.make_adapter([FakeResponse(200, message(attachment=True)), FakeResponse(200, attachments)])
        result = adapter.get_message("AAMk_opaque-1")
        self.assertEqual("hello", result.text)
        self.assertEqual(("person@example.com",), result.recipients)
        self.assertTrue(result.attachments[0].attachment_id.startswith("ma1."))

    def test_get_rejects_body_and_header_budgets(self):
        oversized_body = message()
        oversized_body["body"]["content"] = "x" * (5 * 1024 * 1024 + 1)
        adapter, _ = self.make_adapter([FakeResponse(200, oversized_body)])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("AAMk_opaque-1")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

        too_many_headers = message()
        too_many_headers["internetMessageHeaders"] = [
            {"name": "X-Test", "value": "x"} for _ in range(201)
        ]
        adapter, _ = self.make_adapter([FakeResponse(200, too_many_headers)])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("AAMk_opaque-1")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_search_compiles_safe_kql_and_odata_and_rejects_injection(self):
        adapter, client = self.make_adapter([FakeResponse(200, {"value": []})])
        adapter.search_messages(SearchRequest('from:"a@example.test" subject:"hello" after:2026-01-01 is:unread', limit=3))
        query = parse_qs(urlsplit(client.calls[0][1]).query)
        self.assertEqual('"from:\\"a@example.test\\" AND subject:\\"hello\\""', query["$search"][0])
        self.assertIn("receivedDateTime ge 2026-01-01T00:00:00Z", query["$filter"][0])
        self.assertIn("isRead eq false", query["$filter"][0])
        self.assertEqual("eventual", client.calls[0][2]["ConsistencyLevel"])
        for attack in ('raw:$filter', 'from:"unterminated'):
            with self.subTest(attack=attack), self.assertRaises(MailRuntimeError):
                adapter.search_messages(SearchRequest(attack))

    def test_download_file_attachment_streams_and_rejects_wrong_message(self):
        metadata = {"value": [{
            "@odata.type": "#microsoft.graph.fileAttachment", "id": "att_1", "name": "report.pdf",
            "contentType": "application/pdf", "size": 7, "isInline": False,
        }]}
        content = {**metadata["value"][0], "contentBytes": base64.b64encode(b"PDFDATA").decode()}
        adapter, _ = self.make_adapter([FakeResponse(200, message(attachment=True)), FakeResponse(200, metadata), FakeResponse(200, content)])
        locator = adapter.get_message("AAMk_opaque-1").attachments[0].attachment_id
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink:
                result = adapter.download_attachment(AttachmentRequest("AAMk_opaque-1", locator), sink)
                self.assertEqual(7, result.size)
            with AttachmentSink(workspace, workspace / "other") as sink:
                with self.assertRaises(MailRuntimeError) as raised:
                    adapter.download_attachment(AttachmentRequest("other", locator), sink)
                self.assertEqual(ErrorCode.ATTACHMENT_NOT_FOUND, raised.exception.code)

    def test_invalid_attachment_base64_removes_partial_sink_file(self):
        metadata = {"value": [{
            "@odata.type": "#microsoft.graph.fileAttachment", "id": "att_1", "name": "bad.bin",
            "contentType": "application/octet-stream", "size": 3, "isInline": False,
        }]}
        invalid = {**metadata["value"][0], "contentBytes": "QU!D"}
        adapter, _ = self.make_adapter([
            FakeResponse(200, message(attachment=True)), FakeResponse(200, metadata),
            FakeResponse(200, invalid),
        ])
        locator = adapter.get_message("AAMk_opaque-1").attachments[0].attachment_id
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            output = workspace / "downloads"
            with AttachmentSink(workspace, output) as sink:
                with self.assertRaises(MailRuntimeError):
                    adapter.download_attachment(AttachmentRequest("AAMk_opaque-1", locator), sink)
            self.assertFalse((output / "bad.bin").exists())

    def test_item_attachment_is_unsupported(self):
        adapter, _ = self.make_adapter([FakeResponse(200, message(attachment=True)), FakeResponse(200, {"value": [{
            "@odata.type": "#microsoft.graph.itemAttachment", "id": "att_1", "name": "mail.eml", "size": 10,
        }]})])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("AAMk_opaque-1")
        self.assertEqual(ErrorCode.UNSUPPORTED, raised.exception.code)

    def test_send_uses_draft_then_send_and_bcc_recipient_objects_without_retry(self):
        adapter, client = self.make_adapter([FakeResponse(201, {"id": "draft-1"}), FakeResponse(202, b"", {"Content-Type": ""})])
        draft = Draft(("to@example.test",), (), ("hidden@example.test",), "Hi", "Body", None)
        result = adapter.send_message(draft)
        self.assertEqual("draft-1", result.message_id)
        self.assertEqual(("to@example.test", "hidden@example.test"), result.accepted)
        payload = json.loads(client.calls[0][3])
        self.assertEqual("hidden@example.test", payload["bccRecipients"][0]["emailAddress"]["address"])
        self.assertEqual(["POST", "POST"], [call[0] for call in client.calls])

    def test_send_failure_does_not_retry_or_claim_success(self):
        adapter, client = self.make_adapter([FakeResponse(503, {})])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(("to@example.test",), (), (), "Hi", "Body", None))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertEqual(1, len(client.calls))

    def test_send_stage_failure_does_not_recreate_draft_or_retry_send(self):
        adapter, client = self.make_adapter([FakeResponse(201, {"id": "draft-1"}), FakeResponse(503, {})])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(("to@example.test",), (), (), "Hi", "Body", None))
        self.assertFalse(raised.exception.retryable)
        self.assertTrue(raised.exception.ambiguous)
        self.assertEqual(["POST", "POST"], [call[0] for call in client.calls])

    def test_reply_validates_conversation_and_sends_reply_draft(self):
        recipients = {
            "toRecipients": [{"emailAddress": {"address": "reply@example.test"}}],
            "ccRecipients": [], "bccRecipients": [],
        }
        adapter, client = self.make_adapter([
            FakeResponse(200, message()),
            FakeResponse(201, {"id": "reply-draft", "conversationId": "conv-1", **recipients}),
            FakeResponse(200, {"id": "reply-draft", "conversationId": "conv-1", **recipients}),
            FakeResponse(202, b"", {"Content-Type": ""}),
        ])
        result = adapter.reply_message("AAMk_opaque-1", Draft((), (), (), "", "Thanks", None))
        self.assertEqual("reply-draft", result.message_id)
        self.assertEqual(("reply@example.test",), result.accepted)
        self.assertEqual(["GET", "POST", "PATCH", "POST"], [call[0] for call in client.calls])
        self.assertNotIn("internetMessageId", json.loads(client.calls[2][3]))

    def test_reply_rejects_conversation_mismatch_before_patch(self):
        adapter, client = self.make_adapter([
            FakeResponse(200, message()),
            FakeResponse(201, {"id": "reply-draft", "conversationId": "evil"}),
            FakeResponse(204, b"", {"Content-Type": ""}),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.reply_message("AAMk_opaque-1", Draft((), (), (), "", "Thanks", None))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertEqual(["GET", "POST", "DELETE"], [call[0] for call in client.calls])

    def test_reply_patch_timeout_cleans_known_unsent_draft_and_is_not_ambiguous(self):
        recipients = {
            "toRecipients": [{"emailAddress": {"address": "reply@example.test"}}],
            "ccRecipients": [], "bccRecipients": [],
        }
        adapter, client = self.make_adapter([
            FakeResponse(200, message()),
            FakeResponse(201, {"id": "reply-draft", "conversationId": "conv-1", **recipients}),
            socket.timeout("patch uncertain"),
            FakeResponse(204, b"", {"Content-Type": ""}),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.reply_message("AAMk_opaque-1", Draft((), (), (), "", "x", None))
        self.assertFalse(raised.exception.retryable)
        self.assertFalse(raised.exception.ambiguous)
        self.assertEqual(["GET", "POST", "PATCH", "DELETE"], [call[0] for call in client.calls])

    def test_reply_patch_failure_with_unconfirmed_cleanup_stays_ambiguous(self):
        recipients = {
            "toRecipients": [{"emailAddress": {"address": "reply@example.test"}}],
            "ccRecipients": [], "bccRecipients": [],
        }
        adapter, client = self.make_adapter([
            FakeResponse(200, message()),
            FakeResponse(201, {"id": "reply-draft", "conversationId": "conv-1", **recipients}),
            socket.timeout("patch uncertain"), socket.timeout("cleanup uncertain"),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.reply_message("AAMk_opaque-1", Draft((), (), (), "", "x", None))
        self.assertFalse(raised.exception.retryable)
        self.assertTrue(raised.exception.ambiguous)
        self.assertEqual(["GET", "POST", "PATCH", "DELETE"], [call[0] for call in client.calls])

    def test_create_reply_2xx_without_id_is_ambiguous_and_cannot_cleanup(self):
        adapter, client = self.make_adapter([
            FakeResponse(200, message()), FakeResponse(201, {"conversationId": "conv-1"}),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.reply_message("AAMk_opaque-1", Draft((), (), (), "", "x", None))
        self.assertFalse(raised.exception.retryable)
        self.assertTrue(raised.exception.ambiguous)
        self.assertEqual(["GET", "POST"], [call[0] for call in client.calls])

    def test_reply_reports_caller_modified_final_recipients(self):
        created_recipients = {
            "toRecipients": [{"emailAddress": {"address": "old@example.test"}}],
            "ccRecipients": [], "bccRecipients": [],
        }
        final_recipients = {
            "toRecipients": [{"emailAddress": {"address": "new@example.test"}}],
            "ccRecipients": [{"emailAddress": {"address": "copy@example.test"}}],
            "bccRecipients": [{"emailAddress": {"address": "hidden@example.test"}}],
        }
        adapter, client = self.make_adapter([
            FakeResponse(200, message()),
            FakeResponse(201, {"id": "reply-draft", "conversationId": "conv-1", **created_recipients}),
            FakeResponse(200, {"id": "reply-draft", "conversationId": "conv-1", **final_recipients}),
            FakeResponse(202, b"", {"Content-Type": ""}),
        ])
        draft = Draft(("new@example.test",), ("copy@example.test",), ("hidden@example.test",), "", "x", None)
        result = adapter.reply_message("AAMk_opaque-1", draft)
        self.assertEqual(("new@example.test", "copy@example.test", "hidden@example.test"), result.accepted)
        patch_payload = json.loads(client.calls[2][3])
        self.assertEqual("copy@example.test", patch_payload["ccRecipients"][0]["emailAddress"]["address"])
        self.assertEqual("hidden@example.test", patch_payload["bccRecipients"][0]["emailAddress"]["address"])
        self.assertTrue(all(call[2].get("Prefer") == 'IdType="ImmutableId"' for call in client.calls))

    def test_delete_moves_to_deleteditems_instead_of_delete(self):
        moved = {"id": "AAMk_opaque-1", "parentFolderId": "opaque-folder-id"}
        adapter, client = self.make_adapter([FakeResponse(201, moved)])
        result = adapter.delete_message("AAMk_opaque-1")
        self.assertEqual("AAMk_opaque-1", result.message_id)
        self.assertEqual("trash", result.moved_to)
        self.assertEqual("POST", client.calls[0][0])
        self.assertEqual({"destinationId": "deleteditems"}, json.loads(client.calls[0][3]))

    def test_move_rejects_id_change_under_immutable_id_preference(self):
        adapter, _ = self.make_adapter([FakeResponse(201, {"id": "changed-id", "parentFolderId": "folder-id"})])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.delete_message("AAMk_opaque-1")
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_graph_throttle_reason_on_403_maps_rate_limited(self):
        response = FakeResponse(403, {"error": {"code": "throttledRequest"}})
        adapter, _ = self.make_adapter([response])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
        self.assertEqual(ErrorCode.RATE_LIMITED, raised.exception.code)

    def test_status_mapping_retry_close_and_secret_safe_error(self):
        responses = [FakeResponse(429, {}, {"Retry-After": "0"}), FakeResponse(200, {"value": []})]
        adapter, client = self.make_adapter(responses, sleep=lambda _delay: None)
        adapter.list_messages(ListRequest())
        self.assertEqual(2, len(client.calls))
        self.assertTrue(all(response.closed for response in responses))
        for status, code in ((401, ErrorCode.AUTH_EXPIRED), (403, ErrorCode.PERMISSION_DENIED), (404, ErrorCode.MESSAGE_NOT_FOUND)):
            adapter, _ = self.make_adapter([FakeResponse(status, {"error": {"code": "x"}})])
            with self.subTest(status=status), self.assertRaises(MailRuntimeError) as raised:
                adapter.get_message("AAMk_opaque-1")
            self.assertEqual(code, raised.exception.code)
            self.assertNotIn("graph-access-secret", str(raised.exception))
        adapter, _ = self.make_adapter([socket.timeout("graph-access-secret")])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertNotIn("graph-access-secret", str(raised.exception))

    def test_cursor_accepts_bounded_skip_and_preserves_canonical_query(self):
        select = "id,subject,bodyPreview,receivedDateTime,from,hasAttachments"
        next_link = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?" + urlencode({
            "$select": select, "$orderby": "receivedDateTime desc", "$top": 2, "$skip": 2,
        })
        adapter, client = self.make_adapter([
            FakeResponse(200, {"value": [], "@odata.nextLink": next_link}),
            FakeResponse(200, {"value": []}),
        ])
        cursor = adapter.list_messages(ListRequest(limit=2)).next_cursor
        adapter.list_messages(ListRequest(limit=2, cursor=cursor))
        query = parse_qs(urlsplit(client.calls[1][1]).query)
        self.assertEqual(["2"], query["$skip"])
        self.assertEqual([select], query["$select"])

    def test_get_ignores_hasattachments_hint_and_reads_all_attachment_pages(self):
        detail = message(attachment=False)
        first_link = "https://graph.microsoft.com/v1.0/me/messages/AAMk_opaque-1/attachments?" + urlencode({
            "$select": "id,name,contentType,size,isInline", "$skip": 1,
        })
        first = {"value": [], "@odata.nextLink": first_link}
        inline = {"value": [{
            "@odata.type": "#microsoft.graph.fileAttachment", "id": "inline-1", "name": "inline.png",
            "contentType": "image/png", "size": 3, "isInline": True,
        }]}
        adapter, client = self.make_adapter([
            FakeResponse(200, detail), FakeResponse(200, first), FakeResponse(200, inline),
        ])
        result = adapter.get_message("AAMk_opaque-1")
        self.assertEqual("inline.png", result.attachments[0].filename)
        self.assertEqual(3, len(client.calls))

    def test_search_filter_only_has_no_orderby_and_obrien_is_not_sql_escaped(self):
        adapter, client = self.make_adapter([
            FakeResponse(200, {"value": []}), FakeResponse(200, {"value": []}),
        ])
        adapter.search_messages(SearchRequest("is:unread has:attachment"))
        filter_query = parse_qs(urlsplit(client.calls[0][1]).query)
        self.assertNotIn("$orderby", filter_query)
        self.assertNotIn("$search", filter_query)
        adapter.search_messages(SearchRequest("subject:O'Brien"))
        search_query = parse_qs(urlsplit(client.calls[1][1]).query)
        self.assertEqual('"subject:\\"O\'Brien\\""', search_query["$search"][0])
        self.assertNotIn("$orderby", search_query)

    def test_search_preserves_quoted_phrase_as_one_literal_and_blocks_kql_structure(self):
        adapter, client = self.make_adapter([FakeResponse(200, {"value": []})])
        adapter.search_messages(SearchRequest('subject:"foo OR from:evil@example.test"'))
        query = parse_qs(urlsplit(client.calls[0][1]).query)
        self.assertEqual('"subject:\\"foo OR from:evil@example.test\\""', query["$search"][0])
        for attack in (
            'subject:"unterminated',
            'subject:"bad\\quote"',
            'subject:"bad"tail',
            "subject:bad\x01value",
        ):
            with self.subTest(attack=attack), self.assertRaises(MailRuntimeError) as raised:
                adapter.search_messages(SearchRequest(attack))
            self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_every_user_search_value_is_an_inner_quoted_kql_literal(self):
        values = ("-secret", "+bar", "NEAR", "foo -bar", "foo NEAR bar", "NOT", "AND", "OR")
        responses = [FakeResponse(200, {"value": []}) for _ in range(len(values) + 3)]
        adapter, client = self.make_adapter(responses)
        for index, value in enumerate(values):
            adapter.search_messages(SearchRequest(f'subject:"{value}"'))
            criteria = parse_qs(urlsplit(client.calls[index][1]).query)["$search"][0]
            self.assertEqual(f'"subject:\\"{value}\\""', criteria)
        adapter.search_messages(SearchRequest('"foo NEAR bar"'))
        free_criteria = parse_qs(urlsplit(client.calls[-1][1]).query)["$search"][0]
        self.assertEqual('"\\"foo NEAR bar\\""', free_criteria)
        adapter.search_messages(SearchRequest("foo -bar"))
        self.assertEqual(
            '"\\"foo\\" AND \\"-bar\\""',
            parse_qs(urlsplit(client.calls[-1][1]).query)["$search"][0],
        )
        adapter.search_messages(SearchRequest("foo NEAR bar"))
        self.assertEqual(
            '"\\"foo\\" AND \\"NEAR\\" AND \\"bar\\""',
            parse_qs(urlsplit(client.calls[-1][1]).query)["$search"][0],
        )

    def test_transient_403_throttle_retries_get_but_not_post(self):
        throttle = FakeResponse(403, {"error": {"code": "throttledRequest"}}, {"Retry-After": "0"})
        adapter, client = self.make_adapter([
            throttle, FakeResponse(200, message()), FakeResponse(200, {"value": []}),
        ], sleep=lambda _delay: None)
        adapter.get_message("AAMk_opaque-1")
        self.assertEqual(3, len(client.calls))
        self.assertTrue(throttle.closed)

    def test_retry_after_http_date_is_honored_and_bounded(self):
        delays = []
        adapter, _ = self.make_adapter([
            FakeResponse(429, {}, {"Retry-After": "Mon, 31 Aug 2026 02:00:03 GMT"}),
            FakeResponse(200, {"value": []}),
        ], sleep=delays.append, jitter=lambda: 0, clock=lambda: datetime(2026, 8, 31, 2, 0, tzinfo=timezone.utc))
        adapter.list_messages(ListRequest())
        self.assertEqual([3.0], delays)

    def test_every_request_uses_immutable_graph_ids(self):
        responses = [FakeResponse(201, {"id": "draft-1"}), FakeResponse(202, b"", {"Content-Type": ""})]
        adapter, client = self.make_adapter(responses)
        adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
        self.assertTrue(all(call[2].get("Prefer") == 'IdType="ImmutableId"' for call in client.calls))
        self.assertTrue(all(response.closed for response in responses))

    def test_ambiguous_send_failure_is_not_retryable_and_does_not_cleanup(self):
        adapter, client = self.make_adapter([FakeResponse(201, {"id": "draft-1"}), socket.timeout("uncertain")])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
        self.assertFalse(raised.exception.retryable)
        self.assertTrue(raised.exception.ambiguous)
        self.assertEqual(["POST", "POST"], [call[0] for call in client.calls])

    def test_conclusive_send_rejection_best_effort_cleans_draft_once(self):
        adapter, client = self.make_adapter([
            FakeResponse(201, {"id": "draft-1"}),
            FakeResponse(400, {"error": {"code": "ErrorInvalidRecipients"}}),
            FakeResponse(204, b"", {"Content-Type": ""}),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
        self.assertFalse(raised.exception.retryable)
        self.assertFalse(raised.exception.ambiguous)
        self.assertEqual(["POST", "POST", "DELETE"], [call[0] for call in client.calls])

    def test_send_rejection_with_unconfirmed_cleanup_stays_ambiguous(self):
        adapter, client = self.make_adapter([
            FakeResponse(201, {"id": "draft-1"}),
            FakeResponse(400, {"error": {"code": "ErrorInvalidRecipients"}}),
            socket.timeout("cleanup uncertain"),
        ])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
        self.assertFalse(raised.exception.retryable)
        self.assertTrue(raised.exception.ambiguous)
        self.assertEqual(["POST", "POST", "DELETE"], [call[0] for call in client.calls])

    def test_cleanup_404_confirms_draft_absent_for_send_and_reply(self):
        send_adapter, _ = self.make_adapter([
            FakeResponse(201, {"id": "draft-1"}),
            FakeResponse(400, {"error": {"code": "ErrorInvalidRecipients"}}),
            FakeResponse(404, {"error": {"code": "ErrorItemNotFound"}}),
        ])
        with self.assertRaises(MailRuntimeError) as send_raised:
            send_adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
        self.assertFalse(send_raised.exception.ambiguous)

        reply_adapter, _ = self.make_adapter([
            FakeResponse(200, message()),
            FakeResponse(201, {"id": "reply-draft", "conversationId": "wrong"}),
            FakeResponse(404, {"error": {"code": "ErrorItemNotFound"}}),
        ])
        with self.assertRaises(MailRuntimeError) as reply_raised:
            reply_adapter.reply_message("AAMk_opaque-1", Draft((), (), (), "", "x", None))
        self.assertFalse(reply_raised.exception.ambiguous)

    def test_create_draft_timeout_is_ambiguous_and_not_retryable(self):
        adapter, client = self.make_adapter([socket.timeout("uncertain")])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
        self.assertFalse(raised.exception.retryable)
        self.assertTrue(raised.exception.ambiguous)
        self.assertEqual(1, len(client.calls))

    def test_mutation_2xx_bad_json_or_shape_is_ambiguous_and_not_retryable(self):
        for response in (FakeResponse(201, b"not-json"), FakeResponse(201, {"unexpected": "shape"})):
            adapter, _ = self.make_adapter([response])
            with self.subTest(body=response.body), self.assertRaises(MailRuntimeError) as raised:
                adapter.send_message(Draft(("to@example.test",), (), (), "x", "y", None))
            self.assertFalse(raised.exception.retryable)
            self.assertTrue(raised.exception.ambiguous)

        adapter, _ = self.make_adapter([FakeResponse(201, b"not-json")])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.delete_message("AAMk_opaque-1")
        self.assertFalse(raised.exception.retryable)
        self.assertTrue(raised.exception.ambiguous)

    def test_urllib_client_has_tls_and_no_redirect(self):
        tls_context = object()
        fake_opener = object()
        with patch("mail_runtime.microsoft_graph.build_opener", return_value=fake_opener) as builder:
            client = UrllibMicrosoftGraphHttpClient(ssl_context_factory=lambda: tls_context)
        self.assertIs(fake_opener, client._opener)
        handlers = builder.call_args.args
        self.assertTrue(any(isinstance(handler, _NoRedirect) for handler in handlers))
        https = next(handler for handler in handlers if isinstance(handler, HTTPSHandler))
        self.assertIs(tls_context, https._context)
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 302, "x", {}, "https://evil.test"))

    def test_probe_uses_folder_metadata_and_never_messages(self):
        adapter, client = self.make_adapter([FakeResponse(200, {})])
        adapter.probe_connection()
        self.assertIn("/mailFolders/inbox", client.calls[0][1])
        self.assertNotIn("/messages", client.calls[0][1])


if __name__ == "__main__":
    unittest.main()
