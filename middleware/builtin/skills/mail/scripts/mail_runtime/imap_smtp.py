from __future__ import annotations

import base64
import binascii
import imaplib
import json
import quopri
import re
import shlex
import smtplib
import socket
import ssl
from collections.abc import Callable, Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from email import policy
from email.header import decode_header, make_header
from email.headerregistry import Address
from email.message import EmailMessage, Message
from email.parser import BytesParser
from email.utils import formataddr, getaddresses, make_msgid, parseaddr, parsedate_to_datetime
from typing import Any

from .io_security import AttachmentSink
from .mime import normalize_body
from .models import (
    AccountConfig,
    AttachmentDownloadResult,
    AttachmentMeta,
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
    require_text,
)
from .registry import AdapterRegistry


MAX_PAGE_SIZE = 100
MAX_RAW_MESSAGE_BYTES = 32 * 1024 * 1024
MAX_HEADER_BYTES = 256 * 1024
MAX_MIME_PARTS = 500
MAX_BODY_BYTES = 5 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
MAX_ATTACHMENTS = 100
MAX_RECIPIENTS = 100
MAX_OUTBOUND_BYTES = 25 * 1024 * 1024
MAX_ENCODED_ATTACHMENT_BYTES = 40 * 1024 * 1024
PARTIAL_FETCH_BYTES = 64 * 1024
DEFAULT_TIMEOUT = 30.0
_UID = re.compile(r"[1-9][0-9]{0,19}\Z")
_SEARCH_KEYS = {"from", "to", "subject", "text", "since", "before", "unread", "hasattachment"}
_SAFE_AUTH_TYPES = {"PASSWORD", "APP_PASSWORD", "API_TOKEN"}
_TRASH_DEFAULTS = {
    "qq": ("Deleted Messages", "Trash", "已删除"),
    "netease-163": ("已删除", "Trash", "Deleted Messages"),
    "aliyun-mail": ("已删除", "Trash", "Deleted Messages"),
}
_GENERIC_TRASH_DEFAULTS = ("Trash", "Deleted Messages", "已删除")
_LOCATOR = re.compile(r"[mc]1\.[A-Za-z0-9_-]{8,2000}\Z")
_LOCAL_ATOM = r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+"
_DOMAIN_LABEL = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
_ADDR_SPEC = re.compile(rf"({_LOCAL_ATOM}(?:\.{_LOCAL_ATOM})*)@({_DOMAIN_LABEL}(?:\.{_DOMAIN_LABEL})*)\Z")


@dataclass(frozen=True)
class _Mailbox:
    canonical: str
    wire: str
    uidvalidity: str


@dataclass(frozen=True)
class _MessageLocator:
    mailbox: str
    wire: str
    uidvalidity: str
    uid: str


def _control_free(value: Any, *, maximum: int) -> str:
    return require_text(value, maximum=maximum)


def _port(value: Any) -> int:
    if type(value) is not int or not 1 <= value <= 65535:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return value


def _uid(value: Any) -> str:
    if not isinstance(value, str) or not _UID.fullmatch(value):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return value


def _token(prefix: str, mailbox: str, wire: str, uidvalidity: str, uid: str) -> str:
    payload = json.dumps(
        {"m": mailbox, "u": _uid(uid), "uv": _uid(uidvalidity), "v": 1, "w": wire},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return prefix + "." + base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _parse_token(value: Any, prefix: str) -> _MessageLocator:
    if not isinstance(value, str) or not _LOCATOR.fullmatch(value) or not value.startswith(prefix + "."):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    encoded = value.split(".", 1)[1]
    try:
        raw = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
        payload = json.loads(raw.decode("utf-8"))
    except (binascii.Error, UnicodeError, json.JSONDecodeError) as exc:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
    if not isinstance(payload, dict) or set(payload) != {"m", "u", "uv", "v", "w"} or payload.get("v") != 1:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    mailbox = _control_free(payload.get("m"), maximum=256)
    wire = _control_free(payload.get("w"), maximum=1024)
    try:
        decoded_mailbox = _imap_utf7_decode(wire) if wire.isascii() else None
    except MailRuntimeError as exc:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
    if decoded_mailbox != mailbox:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    locator = _MessageLocator(mailbox, wire, _uid(payload.get("uv")), _uid(payload.get("u")))
    if _token(prefix, locator.mailbox, locator.wire, locator.uidvalidity, locator.uid) != value:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return locator


def _decode_header(value: str | None, *, maximum: int = 64 * 1024) -> str:
    if not value:
        return ""
    try:
        decoded = str(make_header(decode_header(value)))
    except (LookupError, UnicodeError, ValueError, TypeError):
        decoded = str(value)
    return decoded[:maximum]


def _date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        return parsed.isoformat()
    except (TypeError, ValueError, OverflowError):
        return None


def _imap_utf7(value: str) -> str:
    """Encode one mailbox name using IMAP modified UTF-7 (RFC 3501)."""
    _control_free(value, maximum=256)
    output: list[str] = []
    pending: list[str] = []

    def flush() -> None:
        if pending:
            encoded = base64.b64encode("".join(pending).encode("utf-16-be")).decode("ascii")
            output.append("&" + encoded.rstrip("=").replace("/", ",") + "-")
            pending.clear()

    for character in value:
        code = ord(character)
        if 0x20 <= code <= 0x7E:
            flush()
            output.append("&-" if character == "&" else character)
        else:
            pending.append(character)
    flush()
    return "".join(output)


def _imap_utf7_decode(value: str) -> str:
    output: list[str] = []
    index = 0
    while index < len(value):
        if value[index] != "&":
            output.append(value[index])
            index += 1
            continue
        end = value.find("-", index)
        if end < 0:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        encoded = value[index + 1 : end]
        if not encoded:
            output.append("&")
        else:
            try:
                raw = base64.b64decode(encoded.replace(",", "/") + "=" * (-len(encoded) % 4), validate=True)
                output.append(raw.decode("utf-16-be"))
            except (binascii.Error, UnicodeError) as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        index = end + 1
    return "".join(output)


def _imap_astring(value: str, *, maximum: int = 4096) -> str:
    safe = _control_free(value, maximum=maximum)
    return '"' + safe.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _header_value(value: Any, *, maximum: int, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    if not allow_empty and not value.strip():
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return value


def _strict_address(value: Any) -> tuple[Address, str]:
    raw = _header_value(value, maximum=320).strip()
    display = ""
    addr_spec = raw
    bracket = re.fullmatch(r"([^<>,]*)<([^<>]+)>", raw)
    if bracket:
        display = bracket.group(1).strip().strip('"')
        addr_spec = bracket.group(2).strip()
    elif any(character in raw for character in "<>,"):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    match = _ADDR_SPEC.fullmatch(addr_spec)
    if not match or len(match.group(1)) > 64 or len(match.group(2)) > 253:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    try:
        address = Address(display_name=display, username=match.group(1), domain=match.group(2).lower())
    except (TypeError, ValueError) as exc:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
    return address, address.addr_spec


def _extract_bytes(data: Any) -> tuple[bytes, bytes]:
    metadata: list[bytes] = []
    payload = b""
    if not isinstance(data, (list, tuple)):
        return b"", b""
    for item in data:
        if isinstance(item, tuple) and len(item) >= 2:
            if isinstance(item[0], bytes):
                metadata.append(item[0])
            if isinstance(item[1], bytes):
                payload += item[1]
        elif isinstance(item, bytes):
            metadata.append(item)
    return b" ".join(metadata), payload


def _parse_message(raw: bytes) -> EmailMessage:
    if not raw or len(raw) > MAX_RAW_MESSAGE_BYTES:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    header_end = raw.find(b"\r\n\r\n")
    if header_end < 0:
        header_end = raw.find(b"\n\n")
    if header_end < 0 or header_end > MAX_HEADER_BYTES:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    try:
        parsed = BytesParser(policy=policy.default).parsebytes(raw)
    except Exception as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    if not isinstance(parsed, EmailMessage):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    stack: list[tuple[Message, int]] = [(parsed, 0)]
    part_count = 0
    while stack:
        part, depth = stack.pop()
        part_count += 1
        if part_count > MAX_MIME_PARTS or depth > 30:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if part.is_multipart():
            children = part.get_payload()
            if not isinstance(children, list):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            stack.extend((child, depth + 1) for child in children)
    return parsed


def _decoded_payload(part: Message, *, maximum: int) -> bytes:
    try:
        payload = part.get_payload(decode=True)
    except (binascii.Error, UnicodeError, ValueError) as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    if payload is None:
        raw = part.get_payload()
        if not isinstance(raw, str):
            return b""
        charset = part.get_content_charset() or "utf-8"
        try:
            payload = raw.encode(charset, errors="replace")
        except LookupError:
            payload = raw.encode("utf-8", errors="replace")
    if len(payload) > maximum:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return payload


def _part_text(part: Message) -> str:
    payload = _decoded_payload(part, maximum=MAX_BODY_BYTES)
    charset = part.get_content_charset() or "utf-8"
    try:
        text = payload.decode(charset, errors="replace")
    except LookupError:
        text = payload.decode("utf-8", errors="replace")
    normalized = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    if len(normalized.encode("utf-8")) > MAX_BODY_BYTES:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return normalized


def _leaf_parts(message: Message, prefix: str = "") -> Iterable[tuple[str, Message]]:
    if message.is_multipart():
        payload = message.get_payload()
        if not isinstance(payload, list):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        for index, child in enumerate(payload, 1):
            section = f"{prefix}.{index}" if prefix else str(index)
            yield from _leaf_parts(child, section)
    else:
        yield prefix or "1", message


def _attachment_parts(message: EmailMessage) -> list[tuple[str, Message]]:
    result: list[tuple[str, Message]] = []
    for section, part in _leaf_parts(message):
        disposition = part.get_content_disposition()
        filename = part.get_filename()
        if disposition == "attachment" or filename:
            if len(result) >= MAX_ATTACHMENTS:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            result.append((section, part))
    return result


def _internal_date(metadata: bytes) -> str | None:
    match = re.search(rb'\bINTERNALDATE "([^"\r\n]+)"', metadata, re.IGNORECASE)
    if not match:
        return None
    try:
        value = parsedate_to_datetime(match.group(1).decode("ascii").replace("-", " ", 2).strip())
        return value.isoformat() if value.tzinfo is not None else None
    except (UnicodeError, TypeError, ValueError, OverflowError):
        return None


def _message_content(uid: str, message: EmailMessage, metadata: bytes = b"") -> MessageContent:
    text: str | None = None
    html: str | None = None
    for part in message.walk():
        if part.is_multipart() or part.get_content_disposition() == "attachment" or part.get_filename():
            continue
        content_type = part.get_content_type().lower()
        if content_type == "text/plain" and text is None:
            text = _part_text(part)
        elif content_type == "text/html" and html is None:
            html = _part_text(part)
    attachments: list[AttachmentMeta] = []
    for attachment_id, part in _attachment_parts(message):
        payload = _decoded_payload(part, maximum=MAX_ATTACHMENT_BYTES)
        filename = _decode_header(part.get_filename()) or f"attachment-{attachment_id}"
        attachments.append(AttachmentMeta(attachment_id, filename, len(payload), part.get_content_type()))
    recipients = tuple(
        formataddr((name, address)) if name else address
        for name, address in getaddresses(message.get_all("to", []) + message.get_all("cc", []))
        if address
    )
    return MessageContent(
        message_id=uid,
        subject=_decode_header(message.get("subject")),
        sender=_decode_header(message.get("from")) or None,
        recipients=recipients,
        received_at=_internal_date(metadata),
        sent_at=_date(message.get("date")),
        text=text,
        html=html,
        attachments=tuple(attachments),
    )


def _summary(uid: str, message: EmailMessage, metadata: bytes) -> MessageSummary:
    has_attachments = b"ATTACHMENT" in metadata.upper()
    return MessageSummary(
        message_id=uid,
        subject=_decode_header(message.get("subject")),
        sender=_decode_header(message.get("from")) or None,
        received_at=_internal_date(metadata),
        sent_at=_date(message.get("date")),
        preview=None,
        has_attachments=has_attachments,
    )


def _ok(response: Any) -> bool:
    return isinstance(response, tuple) and len(response) == 2 and str(response[0]).upper() == "OK"


class ImapSmtpAdapter:
    def __init__(
        self,
        account: AccountConfig,
        *,
        imap_ssl_factory: Callable[..., Any] = imaplib.IMAP4_SSL,
        imap_factory: Callable[..., Any] = imaplib.IMAP4,
        smtp_ssl_factory: Callable[..., Any] = smtplib.SMTP_SSL,
        smtp_factory: Callable[..., Any] = smtplib.SMTP,
        ssl_context_factory: Callable[[], ssl.SSLContext] = ssl.create_default_context,
        timeout: float = DEFAULT_TIMEOUT,
        partial_chunk_size: int = PARTIAL_FETCH_BYTES,
    ) -> None:
        self._account = account
        self._imap_ssl_factory = imap_ssl_factory
        self._imap_factory = imap_factory
        self._smtp_ssl_factory = smtp_ssl_factory
        self._smtp_factory = smtp_factory
        self._ssl_context_factory = ssl_context_factory
        self._timeout = timeout
        if type(partial_chunk_size) is not int or not 1 <= partial_chunk_size <= PARTIAL_FETCH_BYTES:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        self._partial_chunk_size = partial_chunk_size

    def _endpoint(self, protocol: str) -> tuple[str, int, str]:
        endpoint = self._account.server.get(protocol)
        if not isinstance(endpoint, dict):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        host = _control_free(endpoint.get("host"), maximum=253)
        if any(character.isspace() for character in host):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        port = _port(endpoint.get("port"))
        encryption = _control_free(endpoint.get("encryption"), maximum=16).upper()
        if encryption not in {"SSL", "TLS", "STARTTLS"}:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return host, port, encryption

    def _credentials(self) -> tuple[str, str]:
        auth = self._account.auth
        auth_type = _control_free(auth.get("type"), maximum=64).upper()
        if auth_type not in _SAFE_AUTH_TYPES:
            raise MailRuntimeError(ErrorCode.UNSUPPORTED)
        username = _control_free(auth.get("username", self._account.email), maximum=320)
        secret = _control_free(auth.get("secret"), maximum=16 * 1024)
        return username, secret

    @contextmanager
    def _imap(self):
        client = None
        try:
            host, port, encryption = self._endpoint("imap")
            username, secret = self._credentials()
            context = self._ssl_context_factory()
            if encryption in {"SSL", "TLS"}:
                client = self._imap_ssl_factory(host, port, ssl_context=context, timeout=self._timeout)
            else:
                client = self._imap_factory(host, port, timeout=self._timeout)
                response = client.starttls(ssl_context=context)
                if not _ok(response):
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            try:
                response = client.login(username, secret)
            except imaplib.IMAP4.error as exc:
                raise MailRuntimeError(ErrorCode.AUTH_REQUIRED) from exc
            if not _ok(response):
                raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)
            if self._account.provider == "netease-163":
                # Refresh capabilities after authentication before using the ID extension.
                response = client.capability()
                if not _ok(response):
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                capabilities = b" ".join(
                    item if isinstance(item, bytes) else str(item).encode("ascii")
                    for item in response[1] if item is not None
                ).upper().split()
                if b"ID" in capabilities:
                    response = client.xatom("ID", '("name" "ByClaw" "version" "1.0")')
                    if not _ok(response):
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            yield client
        except MailRuntimeError:
            raise
        except imaplib.IMAP4.abort as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        except imaplib.IMAP4.error as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        except (ssl.SSLError, socket.timeout, TimeoutError, OSError) as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        except Exception as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        finally:
            if client is not None:
                try:
                    client.logout()
                except Exception:
                    pass

    @contextmanager
    def _smtp(self):
        client = None
        try:
            host, port, encryption = self._endpoint("smtp")
            username, secret = self._credentials()
            context = self._ssl_context_factory()
            if encryption in {"SSL", "TLS"}:
                client = self._smtp_ssl_factory(host, port, context=context, timeout=self._timeout)
            else:
                client = self._smtp_factory(host, port, timeout=self._timeout)
                client.ehlo()
                response = client.starttls(context=context)
                if not isinstance(response, tuple) or not 200 <= int(response[0]) < 300:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                client.ehlo()
            client.login(username, secret)
            yield client
        except MailRuntimeError:
            raise
        except smtplib.SMTPAuthenticationError as exc:
            raise MailRuntimeError(ErrorCode.AUTH_REQUIRED) from exc
        except smtplib.SMTPRecipientsRefused as exc:
            raise MailRuntimeError(ErrorCode.PERMISSION_DENIED) from exc
        except (smtplib.SMTPException, ssl.SSLError, socket.timeout, TimeoutError, OSError) as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        except Exception as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        finally:
            if client is not None:
                try:
                    client.quit()
                except Exception:
                    try:
                        client.close()
                    except Exception:
                        pass

    def _select(self, client: Any, folder: str, *, readonly: bool, wire: str | None = None) -> _Mailbox:
        canonical = "INBOX" if folder.lower() == "inbox" else _control_free(folder, maximum=256)
        wire_value = wire or _imap_utf7(canonical)
        encoded = _imap_astring(wire_value, maximum=1024)
        response = client.select(encoded, readonly=readonly)
        if not _ok(response):
            raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)

        try:
            validity_response = client.response("UIDVALIDITY")
        except (imaplib.IMAP4.error, AttributeError) as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        values = validity_response[1] if isinstance(validity_response, tuple) and len(validity_response) == 2 else None
        raw = values[0] if isinstance(values, (list, tuple)) and values else None
        if isinstance(raw, bytes):
            raw = raw.decode("ascii", errors="strict")
        try:
            uidvalidity = _uid(str(raw))
        except (UnicodeError, MailRuntimeError) as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        return _Mailbox(canonical, wire_value, uidvalidity)

    def _select_locator(self, client: Any, token: str, *, readonly: bool) -> tuple[_Mailbox, str]:
        locator = _parse_token(token, "m1")
        mailbox = self._select(client, locator.mailbox, readonly=readonly, wire=locator.wire)
        if mailbox.uidvalidity != locator.uidvalidity:
            raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        return mailbox, locator.uid

    def _message_size(self, client: Any, uid: str) -> int:
        size_response = client.uid("FETCH", _uid(uid), "(RFC822.SIZE)")
        if not _ok(size_response):
            raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        size_metadata, _ = _extract_bytes(size_response[1])
        match = re.search(rb"RFC822\.SIZE\s+(\d+)", size_metadata, re.IGNORECASE)
        if not match:
            raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        size = int(match.group(1))
        if size > MAX_RAW_MESSAGE_BYTES:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return size

    def _fetch_message(self, client: Any, uid: str) -> tuple[EmailMessage, bytes]:
        self._message_size(client, uid)
        response = client.uid("FETCH", _uid(uid), "(UID INTERNALDATE RFC822.SIZE BODY.PEEK[])")
        if not _ok(response):
            raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        metadata, raw = _extract_bytes(response[1])
        if not raw:
            raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        return _parse_message(raw), metadata

    def _page(self, client: Any, mailbox: _Mailbox, request: ListRequest, criteria: tuple[Any, ...]) -> Page:
        if type(request.limit) is not int or not 1 <= request.limit <= MAX_PAGE_SIZE:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        cursor = None
        if request.cursor is not None:
            parsed_cursor = _parse_token(request.cursor, "c1")
            if (
                parsed_cursor.mailbox != mailbox.canonical
                or parsed_cursor.wire != mailbox.wire
                or parsed_cursor.uidvalidity != mailbox.uidvalidity
            ):
                raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
            cursor = parsed_cursor.uid
        response = client.uid("SEARCH", None, *criteria)
        if not _ok(response):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        raw_ids = response[1][0] if response[1] else b""
        if not isinstance(raw_ids, bytes):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        try:
            ids = sorted({_uid(item.decode("ascii")) for item in raw_ids.split()}, key=int, reverse=True)
        except (UnicodeError, MailRuntimeError) as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        if cursor is not None:
            ids = [item for item in ids if int(item) < int(cursor)]
        selected = ids[: request.limit]
        summaries: list[MessageSummary] = []
        fields = "(UID INTERNALDATE FLAGS RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO CC DATE)])"
        for item in selected:
            fetch = client.uid("FETCH", item, fields)
            if not _ok(fetch):
                continue
            metadata, raw = _extract_bytes(fetch[1])
            if not raw or len(raw) > 256 * 1024:
                continue
            raw_summary = _summary(item, _parse_message(raw), metadata)
            summaries.append(
                MessageSummary(
                    _token("m1", mailbox.canonical, mailbox.wire, mailbox.uidvalidity, item),
                    raw_summary.subject,
                    raw_summary.sender,
                    raw_summary.received_at,
                    raw_summary.preview,
                    raw_summary.has_attachments,
                    raw_summary.sent_at,
                )
            )
        next_cursor = (
            _token("c1", mailbox.canonical, mailbox.wire, mailbox.uidvalidity, selected[-1])
            if len(ids) > len(selected) and selected
            else None
        )
        return Page(tuple(summaries), next_cursor)

    def probe_connection(self) -> None:
        with self._imap() as client:
            response = client.select("INBOX", readonly=True)
            if not _ok(response) or not _ok(client.noop()):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)

    def list_messages(self, request: ListRequest) -> Page:
        with self._imap() as client:
            mailbox = self._select(client, request.folder, readonly=True)
            return self._page(client, mailbox, request, ("ALL",))

    def get_message(self, message_id: str) -> MessageContent:
        with self._imap() as client:
            _mailbox, uid = self._select_locator(client, message_id, readonly=True)
            message, metadata = self._fetch_message(client, uid)
            return _message_content(message_id, message, metadata)

    def _search_criteria(self, query: str) -> tuple[Any, ...]:
        query = _control_free(query, maximum=4096)
        try:
            tokens = shlex.split(query, posix=True)
        except ValueError as exc:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
        if not tokens or len(tokens) > 32:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        criteria: list[Any] = []
        for token in tokens:
            if ":" not in token:
                key, value = "text", token
            else:
                key, value = token.split(":", 1)
                key = key.lower()
            if (
                key not in _SEARCH_KEYS
                or not value
                or any(ord(c) < 32 or ord(c) == 127 for c in value)
                or any(c in value for c in "()\\")
            ):
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            if key in {"from", "to", "subject", "text"}:
                criteria.extend(
                    ({"from": "FROM", "to": "TO", "subject": "SUBJECT", "text": "TEXT"}[key], _imap_astring(value))
                )
            elif key in {"since", "before"}:
                try:
                    parsed = datetime.strptime(value, "%Y-%m-%d")
                except ValueError as exc:
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
                criteria.extend((key.upper(), parsed.strftime("%d-%b-%Y")))
            elif key == "unread":
                if value.lower() not in {"true", "false"}:
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                criteria.append("UNSEEN" if value.lower() == "true" else "SEEN")
            elif key == "hasattachment":
                if value.lower() != "true":
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                criteria.extend(("HEADER", _imap_astring("Content-Disposition"), _imap_astring("attachment")))
        return tuple(criteria)

    def search_messages(self, request: SearchRequest) -> Page:
        with self._imap() as client:
            mailbox = self._select(client, "INBOX", readonly=True)
            if any(ord(character) > 127 for character in request.query):
                capabilities = {
                    item.decode("ascii", errors="ignore").upper()
                    if isinstance(item, bytes)
                    else str(item).upper()
                    for item in getattr(client, "capabilities", ())
                }
                if "UTF8=ACCEPT" not in capabilities or not hasattr(client, "enable"):
                    raise MailRuntimeError(ErrorCode.UNSUPPORTED)
                try:
                    enabled = client.enable("UTF8=ACCEPT")
                except imaplib.IMAP4.error as exc:
                    raise MailRuntimeError(ErrorCode.UNSUPPORTED) from exc
                if not _ok(enabled):
                    raise MailRuntimeError(ErrorCode.UNSUPPORTED)
            criteria = self._search_criteria(request.query)
            return self._page(client, mailbox, ListRequest("INBOX", request.limit, request.cursor), criteria)

    def download_attachment(
        self, request: AttachmentRequest, sink: AttachmentSink
    ) -> AttachmentDownloadResult:
        with self._imap() as client:
            _mailbox, uid = self._select_locator(client, request.message_id, readonly=True)
            self._message_size(client, uid)
            section = request.attachment_id
            if not isinstance(section, str) or not re.fullmatch(r"[1-9][0-9]*(?:\.[1-9][0-9]*){0,20}", section):
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            header_response = client.uid("FETCH", uid, f"(BODY.PEEK[{section}.MIME])")
            if not _ok(header_response):
                raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
            _, header_bytes = _extract_bytes(header_response[1])
            if not header_bytes or len(header_bytes) > MAX_HEADER_BYTES:
                raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
            try:
                part = BytesParser(policy=policy.default).parsebytes(header_bytes + b"\r\n")
            except Exception as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            disposition = part.get_content_disposition()
            filename = _decode_header(part.get_filename())
            if disposition != "attachment" and not filename:
                raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
            filename = filename or f"attachment-{section}"
            encoding = (part.get("Content-Transfer-Encoding") or "7bit").strip().lower()
            if encoding not in {"7bit", "8bit", "binary", "base64", "quoted-printable"}:
                raise MailRuntimeError(ErrorCode.UNSUPPORTED)

            def encoded_chunks() -> Iterable[bytes]:
                offset = 0
                total = 0
                while True:
                    response = client.uid(
                        "FETCH", uid, f"(BODY.PEEK[{section}]<{offset}.{self._partial_chunk_size}>)"
                    )
                    if not _ok(response):
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                    _, chunk = _extract_bytes(response[1])
                    if len(chunk) > self._partial_chunk_size:
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_ENCODED_ATTACHMENT_BYTES:
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                    yield chunk
                    offset += len(chunk)
                    if len(chunk) < self._partial_chunk_size:
                        break

            def decoded_chunks() -> Iterable[bytes]:
                decoded_total = 0
                carry = b""
                for chunk in encoded_chunks():
                    if encoding == "base64":
                        compact = re.sub(rb"\s+", b"", carry + chunk)
                        ready_length = len(compact) - (len(compact) % 4)
                        ready, carry = compact[:ready_length], compact[ready_length:]
                        try:
                            decoded = base64.b64decode(ready, validate=True) if ready else b""
                        except binascii.Error as exc:
                            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
                    elif encoding == "quoted-printable":
                        carry += chunk
                        boundary = carry.rfind(b"\n")
                        if boundary < 0:
                            if len(carry) > 128 * 1024:
                                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                            continue
                        ready, carry = carry[: boundary + 1], carry[boundary + 1 :]
                        decoded = quopri.decodestring(ready)
                    else:
                        decoded = chunk
                    decoded_total += len(decoded)
                    if decoded_total > MAX_ATTACHMENT_BYTES:
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                    if decoded:
                        yield decoded
                if encoding == "base64":
                    try:
                        tail = base64.b64decode(carry, validate=True) if carry else b""
                    except binascii.Error as exc:
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
                elif encoding == "quoted-printable":
                    if carry.endswith(b"="):
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                    tail = quopri.decodestring(carry)
                else:
                    tail = b""
                decoded_total += len(tail)
                if decoded_total > MAX_ATTACHMENT_BYTES:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                if tail:
                    yield tail

            return sink.write(filename, decoded_chunks(), content_type=part.get_content_type())

    def _outbound(self, draft: Draft) -> tuple[EmailMessage, str, tuple[str, ...]]:
        all_recipients = draft.to + draft.cc + draft.bcc
        if not all_recipients or len(all_recipients) > MAX_RECIPIENTS:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        parsed_groups: dict[str, tuple[tuple[Address, str], ...]] = {}
        for name, recipients in (("to", draft.to), ("cc", draft.cc), ("bcc", draft.bcc)):
            parsed_groups[name] = tuple(_strict_address(item) for item in recipients)
        deduplicated: dict[str, str] = {}
        for address, addr_spec in parsed_groups["to"] + parsed_groups["cc"] + parsed_groups["bcc"]:
            deduplicated.setdefault(addr_spec.casefold(), addr_spec)
        if len(deduplicated) > MAX_RECIPIENTS:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        sender_address, sender_addr_spec = _strict_address(self._account.email)
        if self._account.display_name:
            sender_address = Address(
                display_name=_header_value(self._account.display_name, maximum=256),
                username=sender_address.username,
                domain=sender_address.domain,
            )
        try:
            message = EmailMessage(policy=policy.default)
            message["Message-ID"] = make_msgid()
            message["From"] = sender_address
            if parsed_groups["to"]:
                message["To"] = tuple(item[0] for item in parsed_groups["to"])
            if parsed_groups["cc"]:
                message["Cc"] = tuple(item[0] for item in parsed_groups["cc"])
            message["Subject"] = _header_value(draft.subject, maximum=998, allow_empty=True)
            if draft.text is not None:
                message.set_content(normalize_body(draft.text), charset="utf-8")
                if draft.html is not None:
                    message.add_alternative(normalize_body(draft.html), subtype="html", charset="utf-8")
            else:
                message.set_content(normalize_body(draft.html or ""), subtype="html", charset="utf-8")
        except (TypeError, ValueError) as exc:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
        if len(message.as_bytes()) > MAX_OUTBOUND_BYTES:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return message, sender_addr_spec, tuple(deduplicated.values())

    def send_message(self, draft: Draft) -> SendResult:
        message, sender, recipients = self._outbound(draft)
        with self._smtp() as client:
            refused = client.send_message(message, from_addr=sender, to_addrs=recipients)
        rejected_keys = {str(address).casefold() for address in refused}
        accepted = tuple(address for address in recipients if address.casefold() not in rejected_keys)
        rejected = tuple(address for address in recipients if address.casefold() in rejected_keys)
        if not accepted:
            raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
        return SendResult(str(message["Message-ID"]), accepted, rejected, bool(rejected))

    def reply_message(self, message_id: str, draft: Draft) -> ReplyResult:
        with self._imap() as client:
            _mailbox, uid = self._select_locator(client, message_id, readonly=True)
            original, _metadata = self._fetch_message(client, uid)
        try:
            original_id = _header_value(str(original.get("Message-ID") or ""), maximum=998)
            references = _header_value(
                _decode_header(original.get("References"), maximum=4096), maximum=4096, allow_empty=True
            )
            if not re.fullmatch(r"<[^<>\s@]+@[^<>\s@]+>", original_id):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            if references and not all(
                re.fullmatch(r"<[^<>\s@]+@[^<>\s@]+>", item)
                for item in references.split()
            ):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        except MailRuntimeError as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        except Exception as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        if not draft.to and not draft.cc and not draft.bcc:
            try:
                _sender_address, sender = _strict_address(
                    _decode_header(original.get("Reply-To") or original.get("From"))
                )
            except MailRuntimeError as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            draft = Draft((sender,), draft.cc, draft.bcc, draft.subject, draft.text, draft.html)
        subject = draft.subject or _decode_header(original.get("Subject"))
        if not subject.lower().startswith("re:"):
            subject = "Re: " + subject
        if not draft.subject:
            try:
                subject = _header_value(subject, maximum=998, allow_empty=True)
            except MailRuntimeError as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        draft = Draft(draft.to, draft.cc, draft.bcc, subject, draft.text, draft.html)
        message, sender, recipients = self._outbound(draft)
        message["In-Reply-To"] = original_id
        message["References"] = " ".join(item for item in (references, original_id) if item)
        with self._smtp() as client:
            refused = client.send_message(message, from_addr=sender, to_addrs=recipients)
        rejected_keys = {str(address).casefold() for address in refused}
        accepted = tuple(address for address in recipients if address.casefold() not in rejected_keys)
        rejected = tuple(address for address in recipients if address.casefold() in rejected_keys)
        if not accepted:
            raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
        return ReplyResult(str(message["Message-ID"]), accepted, rejected, bool(rejected))

    def _trash(self, client: Any) -> tuple[str, str]:
        response = client.list("", "*")
        listed: list[tuple[str, str]] = []
        if _ok(response):
            for item in response[1] or ():
                if not isinstance(item, bytes):
                    continue
                try:
                    text = item.decode("ascii")
                except UnicodeError as exc:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
                match = re.fullmatch(
                    r"\((?P<flags>[^)]*)\)\s+(?P<delimiter>NIL|\"(?:\\.|[^\"])*\")\s+(?P<mailbox>\"(?:\\.|[^\"])*\"|[^\s]+)",
                    text,
                )
                if not match:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                flags = {flag.lower() for flag in match.group("flags").split()}
                mailbox_token = match.group("mailbox")
                if mailbox_token.startswith('"'):
                    wire_name = re.sub(r"\\(.)", r"\1", mailbox_token[1:-1])
                else:
                    wire_name = mailbox_token
                canonical = _imap_utf7_decode(wire_name)
                listed.append((canonical, wire_name))
                if "\\trash" in flags:
                    return canonical, _imap_astring(wire_name, maximum=1024)
        configured = self._account.server.get("trashFolder")
        if isinstance(configured, str) and configured:
            canonical = _control_free(configured, maximum=256)
            return canonical, _imap_astring(_imap_utf7(canonical), maximum=1024)
        defaults = _TRASH_DEFAULTS.get(self._account.provider, _GENERIC_TRASH_DEFAULTS)
        by_name = {canonical.casefold(): (canonical, wire) for canonical, wire in listed}
        for candidate in defaults:
            match = by_name.get(candidate.casefold())
            if match is not None:
                return match[0], _imap_astring(match[1], maximum=1024)
        canonical = defaults[0]
        return canonical, _imap_astring(_imap_utf7(canonical), maximum=1024)

    def delete_message(self, message_id: str) -> DeleteResult:
        with self._imap() as client:
            _source, uid = self._select_locator(client, message_id, readonly=False)
            trash_canonical, trash_wire = self._trash(client)
            exists = client.uid("FETCH", uid, "(UID)")
            exists_metadata, exists_payload = _extract_bytes(exists[1]) if _ok(exists) else (b"", b"")
            if not exists_metadata and not exists_payload:
                raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
            capabilities = {
                item.decode("ascii", errors="ignore").upper() if isinstance(item, bytes) else str(item).upper()
                for item in getattr(client, "capabilities", ())
            }
            if "MOVE" in capabilities:
                response = client.uid("MOVE", uid, trash_wire)
                if not _ok(response):
                    raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
            elif "UIDPLUS" in capabilities:
                if not _ok(client.uid("COPY", uid, trash_wire)):
                    raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
                if not _ok(client.uid("STORE", uid, "+FLAGS.SILENT", "(\\Deleted)")):
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                if not _ok(client.uid("EXPUNGE", uid)):
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            else:
                raise MailRuntimeError(ErrorCode.UNSUPPORTED)
        return DeleteResult(message_id, trash_canonical)


def register_imap_smtp(registry: AdapterRegistry) -> None:
    registry.register("imap_smtp", ImapSmtpAdapter)
