from __future__ import annotations

import os
import ssl
import sys
import tempfile
import unittest
from email import policy
from email.message import EmailMessage
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

try:
    from ._support import account
except ImportError:
    from _support import account
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
from mail_runtime.imap_smtp import ImapSmtpAdapter, _token, register_imap_smtp
from mail_runtime.registry import AdapterRegistry, build_default_registry


def sample_message() -> bytes:
    message = EmailMessage(policy=policy.default)
    message["Message-ID"] = "<original@example.test>"
    message["References"] = "<root@example.test>"
    message["Subject"] = "=?utf-8?b?5rWL6K+V5Li76aKY?="
    message["From"] = "=?utf-8?b?5byg5LiJ?= <sender@example.test>"
    message["To"] = "Person <person@example.com>"
    message["Date"] = "Mon, 31 Aug 2026 10:00:00 +0800"
    message.set_content("plain body")
    message.add_alternative("<p>html body</p>", subtype="html")
    message.add_attachment(b"attachment-data", maintype="application", subtype="octet-stream", filename="report.txt")
    return message.as_bytes()


class FakeImap:
    def __init__(self, raw: bytes | None = None, *, capabilities=(), fail_login=False, uidvalidity="777") -> None:
        self.raw = raw or sample_message()
        self.capabilities = tuple(capabilities)
        self.fail_login = fail_login
        self.calls: list[tuple] = []
        self.closed = False
        self.selected = None
        self.missing = False
        self.uidvalidity = uidvalidity
        self.partial_payload = b"YXR0YWNobWVudC1kYXRh"
        self.reported_size = None
        self.list_rows = [b'(\\HasNoChildren \\Trash) "/" "Deleted Messages"']
        self.fail_select = False

    def starttls(self, ssl_context=None):
        self.calls.append(("starttls", ssl_context))
        return "OK", [b"ready"]

    def login(self, username, secret):
        self.calls.append(("login", username, secret))
        if self.fail_login:
            import imaplib

            raise imaplib.IMAP4.error("authentication failed with leaked-secret")
        return "OK", [b"logged in"]

    def select(self, folder, readonly=False):
        self.calls.append(("select", folder, readonly))
        if self.fail_select:
            import imaplib

            raise imaplib.IMAP4.error("select failed with leaked-secret")
        self.selected = folder
        return "OK", [b"3"]

    def noop(self):
        self.calls.append(("noop",))
        return "OK", [b"ready"]

    def capability(self):
        self.calls.append(("capability",))
        return "OK", [b" ".join(c.encode() if isinstance(c, str) else c for c in self.capabilities)]

    def xatom(self, name, *args):
        self.calls.append((name, *args))
        return "OK", [b"ID completed"]

    def response(self, code):
        self.calls.append(("response", code))
        if code == "UIDVALIDITY":
            return "UIDVALIDITY", [self.uidvalidity.encode()]
        return None, [None]

    def enable(self, capability):
        self.calls.append(("enable", capability))
        return "OK", [b"enabled"]

    def uid(self, command, *args):
        self.calls.append(("uid", command, *args))
        command = command.upper()
        if command == "SEARCH":
            return "OK", [b"9 11 15"]
        if command == "FETCH":
            uid = str(args[0])
            if uid == "404" or self.missing:
                return "OK", [None]
            if str(args[1]) == "(UID)":
                return "OK", [f"{uid} (UID {uid})".encode()]
            if str(args[1]) == "(RFC822.SIZE)":
                size = self.reported_size if self.reported_size is not None else len(self.raw)
                return "OK", [f"{uid} (RFC822.SIZE {size})".encode()]
            request = str(args[1])
            if ".MIME]" in request:
                headers = b'Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="report.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n'
                return "OK", [(f"{uid} ({request} {{{len(headers)}}}".encode(), headers), b")"]
            if "BODY.PEEK[2]<" in request:
                match = __import__("re").search(r"<(\d+)\.(\d+)>", request)
                offset, count = int(match.group(1)), int(match.group(2))
                chunk = self.partial_payload[offset : offset + count]
                return "OK", [(f"{uid} ({request} {{{len(chunk)}}}".encode(), chunk), b")"]
            if "HEADER.FIELDS" in str(args[1]):
                header = self.raw.split(b"\n\n", 1)[0] + b"\n\n"
                return "OK", [(f"{uid} (UID {uid} RFC822.SIZE {len(self.raw)} FLAGS (\\Seen) BODYSTRUCTURE (ATTACHMENT))".encode(), header), b")"]
            return "OK", [(f"{uid} (UID {uid} RFC822.SIZE {len(self.raw)})".encode(), self.raw), b")"]
        if command in {"MOVE", "COPY", "STORE", "EXPUNGE"}:
            return "OK", [b"done"]
        return "BAD", [b"bad"]

    def list(self, directory="", pattern="*"):
        self.calls.append(("list", directory, pattern))
        return "OK", self.list_rows

    def logout(self):
        self.closed = True
        self.calls.append(("logout",))
        return "BYE", [b"bye"]


class FakeSmtp:
    def __init__(self, *, fail_send=False) -> None:
        self.calls: list[tuple] = []
        self.closed = False
        self.fail_send = fail_send
        self.refused = {}

    def ehlo(self):
        self.calls.append(("ehlo",))
        return 250, b"ok"

    def starttls(self, context=None):
        self.calls.append(("starttls", context))
        return 220, b"ready"

    def login(self, username, secret):
        self.calls.append(("login", username, secret))
        return 235, b"ok"

    def send_message(self, message, from_addr=None, to_addrs=None):
        self.calls.append(("send_message", message, from_addr, tuple(to_addrs or ())))
        if self.fail_send:
            import smtplib

            raise smtplib.SMTPServerDisconnected("leaked-secret")
        return self.refused

    def quit(self):
        self.closed = True
        self.calls.append(("quit",))
        return 221, b"bye"

    def close(self):
        self.closed = True
        self.calls.append(("close",))


class Factories:
    def __init__(self, imap=None, smtp=None) -> None:
        self.imap = imap or FakeImap()
        self.smtp = smtp or FakeSmtp()
        self.imap_args: list[tuple] = []
        self.smtp_args: list[tuple] = []

    def imap_ssl(self, host, port, *, ssl_context, timeout):
        self.imap_args.append(("ssl", host, port, ssl_context, timeout))
        return self.imap

    def imap_plain(self, host, port, *, timeout):
        self.imap_args.append(("plain", host, port, timeout))
        return self.imap

    def smtp_ssl(self, host, port, *, context, timeout):
        self.smtp_args.append(("ssl", host, port, context, timeout))
        return self.smtp

    def smtp_plain(self, host, port, *, timeout):
        self.smtp_args.append(("plain", host, port, timeout))
        return self.smtp


def configured_account(*, imap_encryption="SSL", smtp_encryption="SSL", auth_type="PASSWORD"):
    value = account(provider="imap_smtp")
    value["auth"] = {"type": auth_type, "username": "person@example.com", "secret": "top-secret"}
    value["server"]["imap"]["encryption"] = imap_encryption
    value["server"]["smtp"]["encryption"] = smtp_encryption
    return AccountConfig.from_mapping(value)


class ImapSmtpAdapterTest(unittest.TestCase):
    def test_netease_id_precedes_readonly_mailbox_operations(self):
        for operation in ("probe", "list", "search"):
            with self.subTest(operation=operation):
                value = account(provider="netease-163")
                imap = FakeImap(capabilities=(b"IMAP4rev1", b"ID"))
                adapter, _ = self.make_adapter(config=AccountConfig.from_mapping(value), factories=Factories(imap=imap))
                if operation == "probe":
                    adapter.probe_connection()
                elif operation == "list":
                    adapter.list_messages(ListRequest())
                else:
                    adapter.search_messages(SearchRequest(query="test"))
                names = [call[0] for call in imap.calls]
                self.assertLess(names.index("login"), names.index("ID"))
                self.assertLess(names.index("ID"), names.index("select"))
                self.assertIn(("ID", '("name" "ByClaw" "version" "1.0")'), imap.calls)
                self.assertTrue(all(call[2] for call in imap.calls if call[0] == "select"))

    def test_netease_id_rejection_stops_before_mailbox_access(self):
        value = account(provider="netease-163")
        imap = FakeImap(capabilities=("ID",))
        imap.xatom = lambda *args: ("NO", [b"private-server-detail"])
        adapter, _ = self.make_adapter(config=AccountConfig.from_mapping(value), factories=Factories(imap=imap))
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.probe_connection()
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertNotIn("private-server-detail", str(raised.exception))
        self.assertFalse(any(call[0] == "select" for call in imap.calls))
        self.assertTrue(imap.closed)

    def test_id_is_not_sent_for_qq_or_when_extension_is_absent(self):
        for provider, capabilities in (("qq", ("ID",)), ("netease-163", ())):
            value = account(provider=provider)
            imap = FakeImap(capabilities=capabilities)
            adapter, _ = self.make_adapter(config=AccountConfig.from_mapping(value), factories=Factories(imap=imap))
            adapter.probe_connection()
            self.assertFalse(any(call[0] == "ID" for call in imap.calls))

    def make_adapter(self, **kwargs):
        factories = kwargs.pop("factories", Factories())
        adapter = ImapSmtpAdapter(
            kwargs.pop("config", configured_account()),
            imap_ssl_factory=factories.imap_ssl,
            imap_factory=factories.imap_plain,
            smtp_ssl_factory=factories.smtp_ssl,
            smtp_factory=factories.smtp_plain,
            **kwargs,
        )
        return adapter, factories

    def test_registers_generic_provider(self):
        registry = AdapterRegistry()
        register_imap_smtp(registry)
        self.assertIsInstance(registry.adapter_for(configured_account()), ImapSmtpAdapter)

    def test_default_registry_routes_real_backend_provider_codes(self):
        registry = build_default_registry()
        for provider in ("qq", "netease-163", "aliyun-mail", "custom-imap"):
            value = account(provider=provider)
            value["auth"] = {"type": "APP_PASSWORD", "username": "person@example.com", "secret": "secret"}
            self.assertIsInstance(registry.adapter_for(AccountConfig.from_mapping(value)), ImapSmtpAdapter)

    def test_default_registry_does_not_route_iwhalecloud(self):
        value = account(provider="iwhalecloud")
        with self.assertRaises(MailRuntimeError) as raised:
            build_default_registry().adapter_for(AccountConfig.from_mapping(value))
        self.assertEqual(ErrorCode.UNSUPPORTED, raised.exception.code)

    def test_default_registry_routes_fastmail_api_token_to_jmap_not_imap(self):
        from mail_runtime.fastmail_jmap import FastmailJmapAdapter

        registry = build_default_registry()
        value = account(provider="fastmail")
        value["auth"] = {"type": "API_TOKEN", "secret": "secret"}
        value["server"] = {}

        adapter = registry.adapter_for(AccountConfig.from_mapping(value))
        self.assertIsInstance(adapter, FastmailJmapAdapter)
        self.assertNotIsInstance(adapter, ImapSmtpAdapter)

    def test_list_uses_uid_and_returns_stable_descending_page(self):
        adapter, factories = self.make_adapter()
        page = adapter.list_messages(ListRequest(folder="inbox", limit=2))
        self.assertTrue(all(item.message_id.startswith("m1.") for item in page.items))
        self.assertTrue(page.next_cursor.startswith("c1."))
        self.assertEqual("测试主题", page.items[0].subject)
        self.assertTrue(page.items[0].has_attachments)
        self.assertTrue(any(call[:2] == ("uid", "SEARCH") for call in factories.imap.calls))
        self.assertTrue(all(call[1] == "FETCH" for call in factories.imap.calls if call[0] == "uid" and call[1] != "SEARCH"))
        self.assertTrue(factories.imap.closed)

    def test_get_parses_multipart_and_attachment_metadata(self):
        adapter, factories = self.make_adapter()
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        factories.imap.calls.clear()
        message = adapter.get_message(locator)
        self.assertEqual("plain body\n", message.text)
        self.assertIn("html body", message.html)
        self.assertEqual("report.txt", message.attachments[0].filename)
        self.assertEqual("2", message.attachments[0].attachment_id)
        self.assertEqual(("Person <person@example.com>",), message.recipients)
        self.assertTrue(factories.imap.closed)

    def test_search_builds_safe_structured_criteria_and_rejects_injection(self):
        adapter, factories = self.make_adapter()
        page = adapter.search_messages(SearchRequest('from:sender@example.test subject:"hello world" unread:true', limit=1))
        search = next(call for call in factories.imap.calls if call[:2] == ("uid", "SEARCH"))
        wire = repr(search)
        self.assertIn("FROM", wire)
        self.assertIn("SUBJECT", wire)
        self.assertIn("UNSEEN", wire)
        self.assertIn('"hello world"', wire)
        self.assertEqual(1, len(page.items))
        for query in ('raw:UID EXPUNGE', 'from:"x\\" ) UID STORE 1 +FLAGS (\\Deleted)"', "text:a\r\nEXPUNGE"):
            with self.subTest(query=query):
                with self.assertRaises(MailRuntimeError) as raised:
                    adapter.search_messages(SearchRequest(query))
                self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_non_ascii_search_requires_and_enables_utf8_accept(self):
        adapter, _ = self.make_adapter()
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.search_messages(SearchRequest("subject:中文"))
        self.assertEqual(ErrorCode.UNSUPPORTED, raised.exception.code)
        imap = FakeImap(capabilities=("UTF8=ACCEPT",))
        adapter, _ = self.make_adapter(factories=Factories(imap=imap))
        adapter.search_messages(SearchRequest("subject:中文", limit=1))
        self.assertIn(("enable", "UTF8=ACCEPT"), imap.calls)

    def test_attachment_is_written_only_through_sink(self):
        adapter, _ = self.make_adapter()
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            os.chmod(workspace, 0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink:
                result = adapter.download_attachment(AttachmentRequest(locator, "2"), sink)
                finalized = sink.finalize(result)
            self.assertEqual(b"attachment-data", Path(finalized.path).read_bytes())

    def test_attachment_uses_bounded_partial_fetches_and_preflight(self):
        imap = FakeImap()
        adapter, _ = self.make_adapter(factories=Factories(imap=imap), partial_chunk_size=8)
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp).resolve() / "workspace"
            workspace.mkdir(mode=0o700)
            with AttachmentSink(workspace, workspace / "downloads") as sink:
                adapter.download_attachment(AttachmentRequest(locator, "2"), sink)
        partials = [call for call in imap.calls if call[:2] == ("uid", "FETCH") and "BODY.PEEK[2]<" in str(call)]
        self.assertGreaterEqual(len(partials), 2)
        self.assertFalse(any("BODY.PEEK[]" in str(call) for call in partials))

    def test_send_uses_tls_deduplicates_envelope_and_omits_bcc_header(self):
        adapter, factories = self.make_adapter(config=configured_account(smtp_encryption="STARTTLS"))
        draft = Draft(
            to=("a@example.test", "A@example.test"),
            cc=("b@example.test",),
            bcc=("hidden@example.test",),
            subject="hello",
            text="body",
            html="<p>body</p>",
        )
        result = adapter.send_message(draft)
        sent = next(call for call in factories.smtp.calls if call[0] == "send_message")
        message, recipients = sent[1], sent[3]
        self.assertNotIn("Bcc", message)
        self.assertEqual(("a@example.test", "b@example.test", "hidden@example.test"), recipients)
        self.assertEqual("hello", message["Subject"])
        self.assertTrue(any(call[0] == "starttls" for call in factories.smtp.calls))
        self.assertTrue(factories.smtp.closed)
        self.assertTrue(result.message_id.startswith("<"))

    def test_reply_uses_original_thread_headers_and_safe_default_recipient(self):
        adapter, factories = self.make_adapter()
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        adapter.reply_message(locator, Draft(subject="", text="reply"))
        sent = next(call for call in factories.smtp.calls if call[0] == "send_message")
        message = sent[1]
        self.assertEqual("<original@example.test>", message["In-Reply-To"])
        self.assertEqual("<root@example.test> <original@example.test>", message["References"])
        self.assertEqual("Re: 测试主题", str(message["Subject"]))
        self.assertEqual(("sender@example.test",), sent[3])

    def test_delete_uses_uid_move_or_safe_uidplus_fallback_only(self):
        move_imap = FakeImap(capabilities=("MOVE",))
        adapter, _ = self.make_adapter(factories=Factories(imap=move_imap))
        valid_locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        adapter.delete_message(valid_locator)
        self.assertIn(("uid", "MOVE", "15", '"Deleted Messages"'), move_imap.calls)

        fallback = FakeImap(capabilities=("UIDPLUS",))
        adapter, _ = self.make_adapter(factories=Factories(imap=fallback))
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        adapter.delete_message(locator)
        commands = [call[:2] for call in fallback.calls if call[0] == "uid"]
        self.assertIn(("uid", "COPY"), commands)
        self.assertIn(("uid", "STORE"), commands)
        self.assertIn(("uid", "EXPUNGE"), commands)
        self.assertFalse(any(call[0].lower() == "expunge" for call in fallback.calls))

        unsafe = FakeImap(capabilities=())
        adapter, _ = self.make_adapter(factories=Factories(imap=unsafe))
        with self.assertRaises(MailRuntimeError) as raised:
            locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
            adapter.delete_message(locator)
        self.assertEqual(ErrorCode.UNSUPPORTED, raised.exception.code)

        missing = FakeImap(capabilities=("MOVE",))
        missing.missing = True
        adapter, _ = self.make_adapter(factories=Factories(imap=missing))
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.delete_message(valid_locator)
        self.assertEqual(ErrorCode.MESSAGE_NOT_FOUND, raised.exception.code)
        self.assertFalse(any(call[:2] == ("uid", "MOVE") for call in missing.calls))

    def test_trash_list_preserves_wire_encoding_and_decodes_canonical_name(self):
        imap = FakeImap(capabilities=("MOVE",))
        imap.list_rows = [b'(\\HasNoChildren \\Trash) "/" "&XfJSIJZk-"']
        adapter, _ = self.make_adapter(factories=Factories(imap=imap))
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        result = adapter.delete_message(locator)
        self.assertEqual("已删除", result.moved_to)
        self.assertIn(("uid", "MOVE", "15", '"&XfJSIJZk-"'), imap.calls)

        escaped = FakeImap(capabilities=("MOVE",))
        escaped.list_rows = [b'(\\HasNoChildren \\Trash) "/" "Trash\\\"Box"']
        adapter, _ = self.make_adapter(factories=Factories(imap=escaped))
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        result = adapter.delete_message(locator)
        self.assertEqual('Trash"Box', result.moved_to)
        self.assertIn(("uid", "MOVE", "15", '"Trash\\\"Box"'), escaped.calls)

    def test_trash_resolution_uses_known_listed_folder_without_special_use_flag(self):
        imap = FakeImap(capabilities=("MOVE",))
        imap.list_rows = [
            b'(\\HasNoChildren) "/" "INBOX"',
            b'(\\HasNoChildren) "/" "Deleted Messages"',
        ]
        adapter, _ = self.make_adapter(factories=Factories(imap=imap))
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id

        result = adapter.delete_message(locator)

        self.assertEqual("Deleted Messages", result.moved_to)
        self.assertIn(("uid", "MOVE", "15", '"Deleted Messages"'), imap.calls)

    def test_trash_resolution_uses_provider_default_when_server_has_no_hint(self):
        expected_defaults = {
            "qq": "Deleted Messages",
            "netease-163": "已删除",
            "aliyun-mail": "已删除",
            "custom-imap": "Trash",
        }
        for provider, expected in expected_defaults.items():
            with self.subTest(provider=provider):
                imap = FakeImap(capabilities=("MOVE",))
                imap.list_rows = []
                value = account(provider=provider)
                value["auth"] = {
                    "type": "APP_PASSWORD",
                    "username": "person@example.com",
                    "secret": "secret",
                }
                adapter, _ = self.make_adapter(
                    config=AccountConfig.from_mapping(value),
                    factories=Factories(imap=imap),
                )
                locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id

                result = adapter.delete_message(locator)

                self.assertEqual(expected, result.moved_to)

    def test_mailboxes_are_control_free_and_non_ascii_uses_modified_utf7(self):
        adapter, factories = self.make_adapter()
        adapter.list_messages(ListRequest(folder="已删除", limit=1))
        selected = next(call for call in factories.imap.calls if call[0] == "select")
        self.assertEqual('"&XfJSIJZk-"', selected[1])
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.list_messages(ListRequest(folder="INBOX\r\nUID EXPUNGE"))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_outbound_headers_reject_controls_as_invalid_request(self):
        adapter, _ = self.make_adapter()
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.send_message(Draft(to=("a@example.test",), subject="hello\r\nBcc: stolen@example.test", text="x"))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_tls_is_fail_closed_and_validates_configuration(self):
        for protocol, encryption in (("imap", "PLAIN"), ("smtp", "NONE")):
            value = account(provider="imap_smtp")
            value["auth"] = {"type": "PASSWORD", "username": "u", "secret": "s"}
            value["server"][protocol]["encryption"] = encryption
            config = AccountConfig.from_mapping(value)
            adapter, _ = self.make_adapter(config=config)
            operation = adapter.list_messages if protocol == "imap" else adapter.send_message
            argument = ListRequest() if protocol == "imap" else Draft(to=("a@example.test",), text="x")
            with self.assertRaises(MailRuntimeError) as raised:
                operation(argument)
            self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

        for invalid in ("bad\r\nhost", 0, 70000):
            value = account(provider="imap_smtp")
            value["auth"] = {"type": "PASSWORD", "username": "u", "secret": "s"}
            if isinstance(invalid, str):
                value["server"]["imap"]["host"] = invalid
            else:
                value["server"]["imap"]["port"] = invalid
            adapter, _ = self.make_adapter(config=AccountConfig.from_mapping(value))
            with self.assertRaises(MailRuntimeError):
                adapter.list_messages(ListRequest())

    def test_auth_and_network_errors_are_stable_and_secret_free(self):
        import imaplib
        import smtplib

        cases = [
            (Factories(imap=FakeImap(fail_login=True)), lambda adapter: adapter.list_messages(ListRequest()), ErrorCode.AUTH_REQUIRED),
            (Factories(smtp=FakeSmtp(fail_send=True)), lambda adapter: adapter.send_message(Draft(to=("a@example.test",), text="x")), ErrorCode.UPSTREAM_UNAVAILABLE),
        ]
        for factories, operation, expected in cases:
            adapter, _ = self.make_adapter(factories=factories)
            with self.subTest(expected=expected), self.assertRaises(MailRuntimeError) as raised:
                operation(adapter)
            self.assertEqual(expected, raised.exception.code)
            self.assertNotIn("top-secret", str(raised.exception))
            self.assertNotIn("leaked-secret", str(raised.exception))
            self.assertTrue(factories.imap.closed or factories.smtp.closed)

        select_failure = FakeImap()
        select_failure.fail_select = True
        adapter, _ = self.make_adapter(factories=Factories(imap=select_failure))
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.list_messages(ListRequest())
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_limits_and_message_not_found_fail_safely(self):
        adapter, _ = self.make_adapter()
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.list_messages(ListRequest(limit=101))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message("15")
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

        oversized_header = b"Subject: " + (b"x" * (256 * 1024 + 1)) + b"\r\n\r\nbody"
        valid_locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        adapter, _ = self.make_adapter(factories=Factories(imap=FakeImap(raw=oversized_header)))
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message(valid_locator)
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

        oversized = FakeImap()
        oversized.reported_size = 32 * 1024 * 1024 + 1
        adapter, _ = self.make_adapter(factories=Factories(imap=oversized))
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        oversized.calls.clear()
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message(locator)
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)
        self.assertFalse(any("BODY.PEEK[]" in str(call) for call in oversized.calls))

    def test_attachment_rejects_truncated_or_malformed_base64(self):
        for payload in (b"YQ", b"!!!!"):
            with self.subTest(payload=payload):
                imap = FakeImap()
                imap.partial_payload = payload
                adapter, _ = self.make_adapter(factories=Factories(imap=imap), partial_chunk_size=2)
                locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
                with tempfile.TemporaryDirectory() as temp:
                    workspace = Path(temp).resolve() / "workspace"
                    workspace.mkdir(mode=0o700)
                    with AttachmentSink(workspace, workspace / "downloads") as sink:
                        with self.assertRaises(MailRuntimeError) as raised:
                            adapter.download_attachment(AttachmentRequest(locator, "2"), sink)
                    self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_locator_binds_mailbox_uidvalidity_and_rejects_tamper(self):
        imap = FakeImap(uidvalidity="777")
        adapter, _ = self.make_adapter(factories=Factories(imap=imap))
        inbox = adapter.list_messages(ListRequest(folder="INBOX", limit=1)).items[0].message_id
        other = adapter.list_messages(ListRequest(folder="Archive", limit=1)).items[0].message_id
        self.assertNotEqual(inbox, other)
        self.assertNotEqual("15", inbox)
        imap.uidvalidity = "778"
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message(inbox)
        self.assertEqual(ErrorCode.MESSAGE_NOT_FOUND, raised.exception.code)
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message(inbox[:-1] + ("A" if inbox[-1] != "A" else "B"))
        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

        fresh = FakeImap(uidvalidity="777")
        adapter, _ = self.make_adapter(factories=Factories(imap=fresh))
        page = adapter.list_messages(ListRequest(limit=1))
        fresh.uidvalidity = "778"
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.list_messages(ListRequest(limit=1, cursor=page.next_cursor))
        self.assertEqual(ErrorCode.MESSAGE_NOT_FOUND, raised.exception.code)

    def test_locator_with_malformed_client_mailbox_encoding_is_invalid_request(self):
        adapter, _ = self.make_adapter()
        malformed = _token("m1", "Archive", "&broken", "777", "15")

        with self.assertRaises(MailRuntimeError) as raised:
            adapter.get_message(malformed)

        self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_reply_rejects_malformed_upstream_thread_headers_safely(self):
        malformed = sample_message().replace(b"<original@example.test>", b"invalid-thread-id", 1)
        imap = FakeImap(raw=malformed)
        adapter, _ = self.make_adapter(factories=Factories(imap=imap))
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id
        with self.assertRaises(MailRuntimeError) as raised:
            adapter.reply_message(locator, Draft(text="reply"))
        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_reply_maps_oversized_derived_subject_to_upstream_error(self):
        raw = sample_message()
        subject_start = raw.index(b"Subject:")
        subject_end = raw.index(b"\n", subject_start)
        oversized_subject = raw[:subject_start] + b"Subject: " + (b"x" * 998) + raw[subject_end:]
        imap = FakeImap(raw=oversized_subject)
        adapter, _ = self.make_adapter(factories=Factories(imap=imap))
        locator = adapter.list_messages(ListRequest(limit=1)).items[0].message_id

        with self.assertRaises(MailRuntimeError) as raised:
            adapter.reply_message(locator, Draft(text="reply"))

        self.assertEqual(ErrorCode.UPSTREAM_UNAVAILABLE, raised.exception.code)

    def test_strict_recipient_parsing_and_partial_delivery_result(self):
        smtp = FakeSmtp()
        smtp.refused = {"bad@example.test": (550, b"no")}
        adapter, _ = self.make_adapter(factories=Factories(smtp=smtp))
        result = adapter.send_message(Draft(to=("Good <good@example.test>", "bad@example.test"), text="x"))
        self.assertTrue(result.partial)
        self.assertEqual(("good@example.test",), result.accepted)
        self.assertEqual(("bad@example.test",), result.rejected)
        sent = next(call for call in smtp.calls if call[0] == "send_message")
        self.assertEqual(("good@example.test", "bad@example.test"), sent[3])
        self.assertEqual("Good <good@example.test>, bad@example.test", str(sent[1]["To"]))
        for invalid in (
            "Name <>",
            "good@example.test trailing",
            "local-only",
            "a@example.test, b@example.test",
            ".leading@example.test",
            "trailing.@example.test",
            "person@bad-.example",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(MailRuntimeError) as raised:
                adapter.send_message(Draft(to=(invalid,), text="x"))
            self.assertEqual(ErrorCode.INVALID_REQUEST, raised.exception.code)

    def test_probe_selects_readonly_and_never_searches_or_fetches(self):
        adapter, factories = self.make_adapter()
        adapter.probe_connection()
        self.assertIn(("select", "INBOX", True), factories.imap.calls)
        self.assertIn(("noop",), factories.imap.calls)
        self.assertFalse(any(call[0] == "uid" for call in factories.imap.calls))


if __name__ == "__main__":
    unittest.main()
