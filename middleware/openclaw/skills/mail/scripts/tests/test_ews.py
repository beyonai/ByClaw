from __future__ import annotations

import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
MAIL_TESTS = SCRIPTS.parents[0] / "tests"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(MAIL_TESTS))

from _support import account
from mail_runtime.models import AccountConfig, AttachmentRequest, Draft, ErrorCode, ListRequest, MailRuntimeError, SearchRequest


SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
M = "http://schemas.microsoft.com/exchange/services/2006/messages"
T = "http://schemas.microsoft.com/exchange/services/2006/types"


def envelope(operation: str, body: str, code: str = "NoError") -> bytes:
    return f'''<s:Envelope xmlns:s="{SOAP}" xmlns:m="{M}" xmlns:t="{T}"><s:Body>
      <m:{operation}Response><m:ResponseMessages><m:{operation}ResponseMessage ResponseClass="Success">
      <m:ResponseCode>{code}</m:ResponseCode>{body}</m:{operation}ResponseMessage>
      </m:ResponseMessages></m:{operation}Response></s:Body></s:Envelope>'''.encode()


def item_xml(item_id="item-1", change_key="ck-1"):
    return f'''<m:RootFolder IncludesLastItemInRange="true" IndexedPagingOffset="1" TotalItemsInView="1">
      <t:Items><t:Message><t:ItemId Id="{item_id}" ChangeKey="{change_key}"/><t:Subject>Hello</t:Subject>
      <t:DateTimeReceived>2026-08-31T01:02:03Z</t:DateTimeReceived><t:From><t:Mailbox><t:EmailAddress>a@example.test</t:EmailAddress></t:Mailbox></t:From>
      <t:HasAttachments>true</t:HasAttachments><t:Preview>Preview</t:Preview></t:Message></t:Items></m:RootFolder>'''


def ews_account(auth=None, server=None):
    value = account(provider="iwhalecloud")
    value["auth"] = auth or {"type": "KERBEROS"}
    value["server"] = server or {}
    return AccountConfig.from_mapping(value)


class FakeTransport:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def request(self, operation, payload, *, mutation=False):
        self.calls.append((operation, payload, mutation))
        if operation == "GetFolder":
            return envelope("GetFolder", '<m:Folders><t:Folder><t:FolderId Id="root" ChangeKey="root-ck"/></t:Folder></m:Folders>')
        reply = self.replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        return reply


class EwsAdapterTest(unittest.TestCase):
    def test_probe_uses_only_getfolder_id_metadata(self):
        from mail_runtime.ews import EwsAdapter
        transport = FakeTransport([envelope("GetFolder", "")])
        EwsAdapter(ews_account(), transport=transport).probe_connection()
        self.assertEqual(["GetFolder"], [call[0] for call in transport.calls])
        self.assertIn(b"IdOnly", transport.calls[0][1])

    def test_list_and_search_use_finditem_pagination_and_account_bound_locators(self):
        from mail_runtime.ews import EwsAdapter
        transport = FakeTransport([envelope("FindItem", item_xml()), envelope("FindItem", item_xml("item-2", "ck-2"))])
        adapter = EwsAdapter(ews_account(), transport=transport)
        page = adapter.list_messages(ListRequest(limit=2))
        self.assertEqual("Hello", page.items[0].subject)
        self.assertIsNone(page.next_cursor)
        protocol_calls = [call for call in transport.calls if call[0] != "GetFolder"]
        self.assertIn(b"DistinguishedFolderId", protocol_calls[0][1])
        expected_email = ews_account().email.strip().lower().encode()
        self.assertTrue(all(expected_email in call[1] for call in transport.calls))
        search = adapter.search_messages(SearchRequest("from:a@example.test", limit=2))
        protocol_calls = [call for call in transport.calls if call[0] != "GetFolder"]
        self.assertIn(b'QueryString', protocol_calls[1][1])
        other = ews_account()
        object.__setattr__(other, "account_id", "other")
        with self.assertRaises(MailRuntimeError):
            EwsAdapter(other, transport=FakeTransport([])).get_message(page.items[0].message_id)

    def test_get_attachment_send_reply_and_delete_cover_all_soap_operations(self):
        from mail_runtime.ews import EwsAdapter
        attachment = base64.b64encode(b"payload").decode()
        get_body = '''<m:Items><t:Message><t:ItemId Id="item-1" ChangeKey="ck-1"/><t:Subject>Hello</t:Subject>
          <t:Body BodyType="Text">Body</t:Body><t:ToRecipients><t:Mailbox><t:EmailAddress>b@example.test</t:EmailAddress></t:Mailbox></t:ToRecipients>
          <t:Attachments><t:FileAttachment><t:AttachmentId Id="att-1"/><t:Name>a.txt</t:Name><t:ContentType>text/plain</t:ContentType><t:Size>7</t:Size></t:FileAttachment></t:Attachments></t:Message></m:Items>'''
        send_body = '<m:Items><t:Message><t:ItemId Id="draft-1" ChangeKey="draft-ck"/></t:Message></m:Items>'
        replies = [
            envelope("GetItem", get_body), envelope("GetItem", get_body),
            envelope("GetAttachment", f'<m:Attachments><t:FileAttachment><t:AttachmentId Id="att-1"/><t:Name>a.txt</t:Name><t:ContentType>text/plain</t:ContentType><t:Content>{attachment}</t:Content></t:FileAttachment></m:Attachments>'),
            envelope("CreateItem", send_body), envelope("SendItem", ""),
            envelope("CreateItem", send_body), envelope("SendItem", ""),
            envelope("MoveItem", '<m:Items><t:Message><t:ItemId Id="trash-1" ChangeKey="trash-ck"/></t:Message></m:Items>'),
        ]
        transport = FakeTransport(replies)
        adapter = EwsAdapter(ews_account(), transport=transport)
        message = adapter.get_message(adapter.encode_message_locator("item-1", "ck-1"))
        self.assertEqual("Body", message.text)
        self.assertEqual(1, len(message.attachments))
        class Sink:
            def write(self, filename, chunks, *, content_type=None):
                data = b"".join(chunks)
                from mail_runtime.models import AttachmentDownloadResult
                return AttachmentDownloadResult(filename, len(data), content_type)
        downloaded = adapter.download_attachment(AttachmentRequest(message.message_id, message.attachments[0].attachment_id), Sink())
        self.assertEqual(7, downloaded.size)
        sent_receipt = adapter.send_message(Draft(to=("b@example.test",), text="x")).message_id
        reply_receipt = adapter.reply_message(message.message_id, Draft(text="reply")).message_id
        self.assertTrue(sent_receipt.startswith("iwm1."))
        self.assertTrue(reply_receipt.startswith("iwm1."))
        self.assertEqual("trash", adapter.delete_message(message.message_id).moved_to)
        protocol_calls = [call for call in transport.calls if call[0] != "GetFolder"]
        self.assertEqual(["GetItem", "GetItem", "GetAttachment", "CreateItem", "SendItem", "CreateItem", "SendItem", "MoveItem"], [c[0] for c in protocol_calls])
        self.assertEqual([False, False, False, True, True, True, True, True], [c[2] for c in protocol_calls])
        self.assertIn(b'MessageDisposition="SaveOnly"', protocol_calls[3][1])
        self.assertIn(b'<m:SendItem SaveItemToFolder="true">', protocol_calls[4][1])

    def test_rejects_fault_entities_depth_and_oversized_attachment(self):
        import mail_runtime.ews as ews_module
        from mail_runtime.ews import EwsAdapter, MAX_ATTACHMENT_BYTES, parse_xml
        for raw in (b"<!DOCTYPE x><x/>", b"<!ENTITY x 'y'><x/>"):
            with self.assertRaises(MailRuntimeError):
                parse_xml(raw)
        deep = ("<a>" * 40 + "x" + "</a>" * 40).encode()
        with self.assertRaises(MailRuntimeError):
            parse_xml(deep)
        with patch.object(ews_module, "MAX_XML_ELEMENTS", 4):
            with self.assertRaises(MailRuntimeError):
                parse_xml(b"<r><a/><b/><c/><d/></r>")
        with self.assertRaises(MailRuntimeError) as raised:
            EwsAdapter(ews_account(), transport=FakeTransport([envelope("FindItem", "", "ErrorInvalidIdMalformed")])).list_messages(ListRequest())
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)
        content = base64.b64encode(b"x" * (MAX_ATTACHMENT_BYTES + 1)).decode()
        reply = envelope("GetAttachment", f'<m:Attachments><t:FileAttachment><t:AttachmentId Id="a"/><t:Name>x</t:Name><t:Content>{content}</t:Content></t:FileAttachment></m:Attachments>')
        current = envelope("GetItem", '<m:Items><t:Message><t:ItemId Id="i" ChangeKey="c"/><t:Subject>x</t:Subject><t:Attachments><t:FileAttachment><t:AttachmentId Id="a"/><t:Name>x</t:Name><t:Size>1</t:Size></t:FileAttachment></t:Attachments></t:Message></m:Items>')
        adapter = EwsAdapter(ews_account(), transport=FakeTransport([current, reply]))
        with self.assertRaises(MailRuntimeError):
            adapter.download_attachment(AttachmentRequest(adapter.encode_message_locator("i", "c"), adapter.encode_attachment_locator("i", "c", "a")), object())

    def test_curl_transport_uses_fixed_endpoint_netrc_cleanup_and_strict_tls(self):
        from mail_runtime.ews import CurlEwsTransport
        seen = {}
        def runner(argv, **kwargs):
            seen["argv"] = list(argv)
            netrc = Path(argv[argv.index("--netrc-file") + 1])
            seen["mode"] = netrc.stat().st_mode & 0o777
            seen["netrc"] = netrc.read_text()
            class Result:
                returncode = 0
                stdout = envelope("FindItem", item_xml())
                stderr = b""
            return Result()
        transport = CurlEwsTransport(ews_account({"type": "NTLM", "username": "u", "secret": "p"}), runner=runner)
        transport.request("FindItem", b"<x/>")
        self.assertEqual("https://mail.iwhalecloud.com/EWS/Exchange.asmx", seen["argv"][-1])
        self.assertIn("--ntlm", seen["argv"])
        self.assertNotIn("u", seen["argv"])
        self.assertNotIn("p", seen["argv"])
        self.assertNotIn("--insecure", seen["argv"])
        self.assertEqual(0o600, seen["mode"])
        self.assertFalse(Path(seen["argv"][seen["argv"].index("--netrc-file") + 1]).exists())

    def test_netrc_credentials_reject_control_character_injection_before_dispatch(self):
        from mail_runtime.ews import CurlEwsTransport
        called = []
        with self.assertRaises(MailRuntimeError) as raised:
            CurlEwsTransport(
                ews_account({"type": "NTLM", "username": "u\npassword injected", "secret": "p"}),
                runner=lambda *_a, **_k: called.append(True),
            ).request("FindItem", b"<x/>")
        self.assertEqual(ErrorCode.AUTH_REQUIRED, raised.exception.code)
        self.assertEqual([], called)

    def test_kerberos_auth_and_mutation_timeout_are_explicit(self):
        from mail_runtime.ews import CurlEwsTransport
        seen = {}
        def runner(argv, **kwargs):
            seen["argv"] = argv
            raise TimeoutError()
        with patch.dict(os.environ, {"KRB5CCNAME": "FILE:/tmp/cache"}):
            transport = CurlEwsTransport(ews_account(), runner=runner)
            with self.assertRaises(MailRuntimeError) as raised:
                transport.request("CreateItem", b"<x/>", mutation=True)
        self.assertIn("--negotiate", seen["argv"])
        self.assertTrue(raised.exception.ambiguous)

    def test_curl_http_errors_after_mutation_dispatch_are_ambiguous_and_stable(self):
        from mail_runtime.ews import CurlEwsTransport
        class Result:
            returncode = 22
            stderr = b"private upstream detail"
            def __init__(self, status): self.stdout = f"body\n{status}".encode()
        with patch.dict(os.environ, {"KRB5CCNAME": "FILE:/tmp/cache"}):
            for status, code in ((401, ErrorCode.AUTH_REQUIRED), (403, ErrorCode.PERMISSION_DENIED)):
                with self.subTest(status=status), self.assertRaises(MailRuntimeError) as raised:
                    CurlEwsTransport(ews_account(), runner=lambda *_a, **_k: Result(status)).request(
                        "CreateItem", b"<x/>", mutation=True
                    )
                self.assertEqual(code, raised.exception.code)
                self.assertTrue(raised.exception.ambiguous)
                self.assertFalse(raised.exception.fallback_safe)

    def test_malformed_success_response_after_mutation_is_ambiguous(self):
        from mail_runtime.ews import EwsAdapter
        adapter = EwsAdapter(ews_account(), transport=FakeTransport([b"not xml"]))
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(to=("a@example.test",), text="x"))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertTrue(raised.exception.ambiguous)

    def test_post_dispatch_auth_and_move_parse_failures_are_not_fallback_safe(self):
        from mail_runtime.ews import EwsAdapter
        created = envelope("CreateItem", '<m:Items><t:Message><t:ItemId Id="draft" ChangeKey="ck"/></t:Message></m:Items>')
        send_transport = FakeTransport([created, MailRuntimeError(ErrorCode.AUTH_REQUIRED)])
        with self.assertRaises(MailRuntimeError) as send_error:
            EwsAdapter(ews_account(), transport=send_transport).send_message(Draft(to=("a@example.test",), text="x"))
        self.assertEqual(["CreateItem", "SendItem"], [call[0] for call in send_transport.calls if call[0] != "GetFolder"])
        self.assertFalse(send_error.exception.fallback_safe)

        delete_transport = FakeTransport([envelope("MoveItem", "")])
        adapter = EwsAdapter(ews_account(), transport=delete_transport)
        with self.assertRaises(MailRuntimeError) as delete_error:
            adapter.delete_message(adapter.encode_message_locator("item", "ck"))
        self.assertTrue(delete_error.exception.ambiguous)
        self.assertFalse(delete_error.exception.fallback_safe)

    def test_attachment_locator_must_still_belong_to_current_message(self):
        from mail_runtime.ews import EwsAdapter
        current = envelope("GetItem", '<m:Items><t:Message><t:ItemId Id="message-a" ChangeKey="ck-a"/><t:Subject>x</t:Subject><t:Attachments><t:FileAttachment><t:AttachmentId Id="attachment-a"/><t:Name>a</t:Name><t:Size>1</t:Size></t:FileAttachment></t:Attachments></t:Message></m:Items>')
        transport = FakeTransport([current])
        adapter = EwsAdapter(ews_account(), transport=transport)
        message = adapter.encode_message_locator("message-a", "ck-a")
        forged = adapter.encode_attachment_locator("message-a", "ck-a", "attachment-b")
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.download_attachment(AttachmentRequest(message, forged), object())
        self.assertEqual(ErrorCode.ATTACHMENT_NOT_FOUND, raised.exception.code)
        self.assertNotIn("GetAttachment", [call[0] for call in transport.calls])

    def test_all_public_locator_operations_reject_before_any_transport_call(self):
        from mail_runtime.ews import EwsAdapter
        from mail_runtime.locator_security import locator_key, sign_locator
        current = ews_account()
        key = locator_key(current.locator_key)
        valid_message = EwsAdapter(current, transport=FakeTransport([])).encode_message_locator("item", "ck")
        invalid_messages = [
            "ews1.legacy",
            valid_message[:-1] + ("A" if valid_message[-1] != "A" else "B"),
            sign_locator("iwm1", {"v": 1, "p": "other", "a": current.account_id,
                "e": current.email.lower(), "o": "message", "i": "item", "c": "ck"}, key),
            sign_locator("iwm1", {"v": 1, "p": "iwhalecloud", "a": "other",
                "e": current.email.lower(), "o": "message", "i": "item", "c": "ck"}, key),
            sign_locator("iwm1", {"v": 1, "p": "iwhalecloud", "a": current.account_id,
                "e": "delegate@example.test", "o": "message", "i": "item", "c": "ck"}, key),
            sign_locator("iwm1", {"v": 1, "p": "iwhalecloud", "a": current.account_id,
                "e": current.email.lower(), "o": "attachment", "i": "item", "c": "ck"}, key),
        ]
        valid_attachment = EwsAdapter(current, transport=FakeTransport([])).encode_attachment_locator("item", "ck", "att")
        for invalid in invalid_messages:
            for operation in ("get", "reply", "delete", "attachment"):
                transport = FakeTransport([]); adapter = EwsAdapter(current, transport=transport)
                with self.subTest(operation=operation, locator=invalid[:12]), self.assertRaises(MailRuntimeError):
                    if operation == "get": adapter.get_message(invalid)
                    elif operation == "reply": adapter.reply_message(invalid, Draft(text="x"))
                    elif operation == "delete": adapter.delete_message(invalid)
                    else: adapter.download_attachment(AttachmentRequest(invalid, valid_attachment), object())
                self.assertEqual([], transport.calls)
        attachment_base = {"v": 1, "p": "iwhalecloud", "a": current.account_id,
            "e": current.email.lower(), "o": "attachment", "i": "item", "c": "ck", "x": "att"}
        invalid_attachments = [
            "ewsa1.legacy",
            valid_attachment[:-1] + ("A" if valid_attachment[-1] != "A" else "B"),
            sign_locator("iwa1", {**attachment_base, "p": "other"}, key),
            sign_locator("iwa1", {**attachment_base, "a": "other"}, key),
            sign_locator("iwa1", {**attachment_base, "e": "delegate@example.test"}, key),
            sign_locator("iwa1", {**attachment_base, "o": "message"}, key),
            sign_locator("iwa1", {**attachment_base, "i": "other"}, key),
        ]
        for invalid in invalid_attachments:
            transport = FakeTransport([])
            with self.assertRaises(MailRuntimeError):
                EwsAdapter(current, transport=transport).download_attachment(
                    AttachmentRequest(valid_message, invalid), object()
                )
            self.assertEqual([], transport.calls)


if __name__ == "__main__":
    unittest.main()
