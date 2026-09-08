from __future__ import annotations

import base64
import binascii
import html
import io
import json
import os
import re
import selectors
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Protocol

from .io_security import AnchoredPrivateReader, AttachmentSink, relative_from_absolute
from .mime import safe_filename
from .locator_security import locator_key, sign_locator, verify_locator
from .models import (
    AccountConfig, AttachmentDownloadResult, AttachmentMeta, AttachmentRequest, DeleteResult,
    Draft, ErrorCode, ListRequest, MailRuntimeError, MessageContent, MessageSummary, Page,
    ReplyResult, SearchRequest, SendResult,
)

ENDPOINT = "https://mail.iwhalecloud.com/EWS/Exchange.asmx"
SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
M = "http://schemas.microsoft.com/exchange/services/2006/messages"
T = "http://schemas.microsoft.com/exchange/services/2006/types"
MAX_RESPONSE_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
MAX_DEPTH = 32
MAX_XML_ELEMENTS = 10000
MAX_ITEMS = 100
DEFAULT_TIMEOUT = 20.0
PRIVATE_ROOT = Path("/by/.connector-auth/.mail")
_ID = re.compile(r"[^\x00-\x1f\x7f]{1,1024}\Z")
_AUTO_RUNNER = object()


class EwsTransport(Protocol):
    def request(self, operation: str, payload: bytes, *, mutation: bool = False) -> bytes: ...


class PreDispatchProcessError(OSError): pass
class PostDispatchProcessError(OSError): pass


def bounded_run(argv: list[str], *, input: bytes | None = None, timeout: float,
                check: bool = False, capture_output: bool = True) -> subprocess.CompletedProcess[bytes]:
    """Run a fixed argv while terminating before either captured stream exceeds 10 MiB."""
    if check or not capture_output:
        raise ValueError("bounded runner requires captured unchecked output")
    try:
        process = subprocess.Popen(argv, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise PreDispatchProcessError() from exc
    streams = {process.stdout: bytearray(), process.stderr: bytearray()}
    selector = None
    overflow = False
    failure: Exception | None = None
    try:
        selector = selectors.DefaultSelector()
        for stream in streams:
            assert stream is not None
            selector.register(stream, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout
        if input is not None:
            assert process.stdin is not None
            try: process.stdin.write(input)
            finally: process.stdin.close()
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.kill(); process.wait()
                raise subprocess.TimeoutExpired(argv, timeout)
            for key, _ in selector.select(remaining):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj); key.fileobj.close(); continue
                target = streams[key.fileobj]
                room = MAX_RESPONSE_BYTES + 1 - len(target)
                target.extend(chunk[:max(0, room)])
                if len(chunk) > room or len(target) > MAX_RESPONSE_BYTES:
                    overflow = True; process.kill(); break
            if overflow: break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            process.kill(); process.wait()
            raise subprocess.TimeoutExpired(argv, timeout)
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
            raise
    except Exception as exc:
        failure = exc
    finally:
        if failure is not None:
            try: process.kill()
            except Exception as exc:
                if failure is None: failure = exc
            try: process.wait()
            except Exception as exc:
                if failure is None: failure = exc
        if selector is not None:
            try: selector.close()
            except Exception as exc:
                if failure is None: failure = exc
        for stream in streams:
            if stream is not None and not stream.closed:
                try: stream.close()
                except Exception as exc:
                    if failure is None: failure = exc
        if process.stdin is not None and not process.stdin.closed:
            try: process.stdin.close()
            except Exception as exc:
                if failure is None: failure = exc
    if failure is not None:
        if isinstance(failure, subprocess.TimeoutExpired):
            raise failure
        raise PostDispatchProcessError() from failure
    stdout = bytes(streams[process.stdout]); stderr = bytes(streams[process.stderr])
    return subprocess.CompletedProcess(argv, process.returncode or (-9 if overflow else 0), stdout, stderr)


def _temp_file(data: bytes) -> str:
    fd, name = tempfile.mkstemp(prefix="byclaw-mail-", suffix=".private")
    try:
        os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(data):
            written = os.write(fd, data[offset:])
            if written <= 0: raise OSError("short private-file write")
            offset += written
    finally:
        os.close(fd)
    return name


def enterprise_auth_usable(account: AccountConfig) -> bool:
    kind = str(account.auth.get("type", "")).upper()
    if kind in {"KERBEROS", "NEGOTIATE"}:
        return bool(os.environ.get("KRB5CCNAME"))
    if kind not in {"NTLM", "EWS", "APP_PASSWORD", "BASIC_COMPATIBLE"}:
        return False
    credentials = (account.auth.get("username"), account.auth.get("secret"))
    return all(
        isinstance(value, str) and 0 < len(value) <= 16 * 1024
        and not any(ord(character) < 32 or ord(character) == 127 for character in value)
        for value in credentials
    )


class CurlEwsTransport:
    def __init__(self, account: AccountConfig, *, runner: Callable[..., Any] | object = _AUTO_RUNNER,
                 timeout: float = DEFAULT_TIMEOUT, private_root: Path = PRIVATE_ROOT) -> None:
        if not 0 < timeout <= DEFAULT_TIMEOUT:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        self._account = account
        self._runner = bounded_run if runner is _AUTO_RUNNER else runner
        self._timeout = float(timeout)
        self._private_root = private_root
        if not enterprise_auth_usable(account):
            raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)

    def _ca_temp(self) -> str | None:
        value = self._account.server.get("caBundle")
        if value is None:
            return None
        if not isinstance(value, str):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        relative = relative_from_absolute(self._private_root, value)
        raw = AnchoredPrivateReader(self._private_root, max_bytes=1024 * 1024).read_bytes(relative)
        if b"-----BEGIN CERTIFICATE-----" not in raw:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return _temp_file(raw)

    def request(self, operation: str, payload: bytes, *, mutation: bool = False) -> bytes:
        if operation not in {"GetFolder", "FindItem", "GetItem", "GetAttachment", "CreateItem", "SendItem", "MoveItem"}:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if not isinstance(payload, bytes) or not payload or len(payload) > 1024 * 1024:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        temporary: list[str] = []
        argv = [
            "curl", "--silent", "--show-error", "--fail-with-body", "--proto", "=https",
            "--tlsv1.2", "--request", "POST", "--header", "Content-Type: text/xml; charset=utf-8",
            "--header", f"SOAPAction: {M}/{operation}", "--data-binary", "@-",
            "--max-time", str(int(self._timeout)), "--write-out", "\n%{http_code}",
        ]
        kind = str(self._account.auth.get("type", "")).upper()
        try:
            if kind in {"KERBEROS", "NEGOTIATE"}:
                argv.extend(["--negotiate", "-u", ":"])
            else:
                username, secret = self._account.auth["username"], self._account.auth["secret"]
                quote = lambda value: '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
                netrc = _temp_file(
                    f"machine mail.iwhalecloud.com\nlogin {quote(username)}\npassword {quote(secret)}\n".encode()
                )
                temporary.append(netrc)
                argv.extend(["--ntlm", "--netrc-file", netrc])
            ca_file = self._ca_temp()
            if ca_file:
                temporary.append(ca_file)
                argv.extend(["--cacert", ca_file])
            argv.append(ENDPOINT)
            try:
                result = self._runner(argv, input=payload, capture_output=True, timeout=self._timeout, check=False)
            except (TimeoutError, subprocess.TimeoutExpired) as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation) from exc
            except PreDispatchProcessError as exc:
                raise MailRuntimeError(ErrorCode.UNSUPPORTED, ambiguous=False, fallback_safe=True) from exc
            except PostDispatchProcessError as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation) from exc
            except (OSError, ValueError) as exc:
                raise MailRuntimeError(ErrorCode.UNSUPPORTED, ambiguous=False, fallback_safe=True) from exc
            stdout = result.stdout if isinstance(result.stdout, bytes) else b""
            stderr = result.stderr if isinstance(result.stderr, bytes) else b""
            if len(stdout) > MAX_RESPONSE_BYTES + 16 or len(stderr) > MAX_RESPONSE_BYTES:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation)
            status = None
            match = re.search(br"\n([0-9]{3})\Z", stdout)
            if match:
                status = int(match.group(1)); stdout = stdout[:match.start()]
            if status == 401 or (result.returncode == 22 and not stdout):
                raise MailRuntimeError(ErrorCode.AUTH_REQUIRED, ambiguous=mutation)
            if status == 403:
                raise MailRuntimeError(ErrorCode.PERMISSION_DENIED, ambiguous=mutation)
            if result.returncode != 0:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation)
            if not stdout or len(stdout) > MAX_RESPONSE_BYTES:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation)
            return stdout
        finally:
            for name in temporary:
                try: os.unlink(name)
                except FileNotFoundError: pass


def parse_xml(raw: bytes) -> ET.Element:
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_RESPONSE_BYTES:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    upper = raw.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    depth = 0
    elements = 0
    try:
        parser = ET.iterparse(io.BytesIO(raw), events=("start", "end"))
        for event, _ in parser:
            if event == "start":
                depth += 1; elements += 1
                if depth > MAX_DEPTH or elements > MAX_XML_ELEMENTS:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            else:
                depth -= 1
        root = parser.root
    except (ET.ParseError, RecursionError) as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    if root.tag != f"{{{SOAP}}}Envelope":
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return root


def _encode(prefix: str, payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return prefix + "." + base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _decode(value: str, prefix: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, str) or len(value) > 4096 or not value.startswith(prefix + "."):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    try:
        raw = value.split(".", 1)[1]
        data = json.loads(base64.b64decode(raw + "=" * (-len(raw) % 4), altchars=b"-_", validate=True))
    except (ValueError, UnicodeError, json.JSONDecodeError, binascii.Error) as exc:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
    if not isinstance(data, dict) or set(data) != keys or data.get("v") != 1 or _encode(prefix, data) != value:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return data


def _text(node: ET.Element | None, *, maximum: int = 65536, optional: bool = True) -> str | None:
    if node is None:
        return None if optional else ""
    value = node.text or ""
    if len(value.encode()) > maximum or "\x00" in value:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return value


def _response(root: ET.Element, operation: str) -> ET.Element:
    fault = root.find(f".//{{{SOAP}}}Fault")
    if fault is not None:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    messages = root.findall(f".//{{{M}}}{operation}ResponseMessage")
    if len(messages) != 1:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    message = messages[0]
    code = _text(message.find(f"{{{M}}}ResponseCode"), maximum=128, optional=False)
    if message.get("ResponseClass") != "Success" or code != "NoError":
        mapping = {
            "ErrorInvalidIdMalformed": ErrorCode.INVALID_REQUEST,
            "ErrorItemNotFound": ErrorCode.MESSAGE_NOT_FOUND,
            "ErrorAttachmentNotFound": ErrorCode.ATTACHMENT_NOT_FOUND,
            "ErrorAccessDenied": ErrorCode.PERMISSION_DENIED,
            "ErrorInvalidCredentials": ErrorCode.AUTH_REQUIRED,
            "ErrorServerBusy": ErrorCode.RATE_LIMITED,
            "ErrorMailboxStoreUnavailable": ErrorCode.UPSTREAM_UNAVAILABLE,
        }
        raise MailRuntimeError(mapping.get(code, ErrorCode.UPSTREAM_UNAVAILABLE))
    return message


def _soap(body: str) -> bytes:
    return (f'<s:Envelope xmlns:s="{SOAP}" xmlns:m="{M}" xmlns:t="{T}">'
            f'<s:Header><t:RequestServerVersion Version="Exchange2013_SP1"/></s:Header>'
            f'<s:Body>{body}</s:Body></s:Envelope>').encode()


class EwsAdapter:
    def __init__(self, account: AccountConfig, *, transport: EwsTransport | None = None) -> None:
        if account.provider != "iwhalecloud":
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        self._account = account
        self._locator_key = locator_key(account.locator_key)
        self._transport = transport or CurlEwsTransport(account)

    def _distinguished(self, folder: str) -> str:
        email = html.escape(self._account.email.strip().lower())
        return f'<t:DistinguishedFolderId Id="{folder}"><t:Mailbox><t:EmailAddress>{email}</t:EmailAddress></t:Mailbox></t:DistinguishedFolderId>'

    def _ensure_mailbox(self) -> None:
        body = f'<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds>{self._distinguished("msgfolderroot")}</m:FolderIds></m:GetFolder>'
        _response(parse_xml(self._transport.request("GetFolder", _soap(body))), "GetFolder")

    def encode_message_locator(self, item_id: str, change_key: str) -> str:
        if not _ID.fullmatch(item_id) or not _ID.fullmatch(change_key):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return sign_locator("iwm1", {"v": 1, "p": "iwhalecloud", "a": self._account.account_id,
            "e": self._account.email.strip().lower(), "o": "message", "i": item_id, "c": change_key}, self._locator_key)

    def _message_locator(self, value: str) -> dict[str, Any]:
        data = verify_locator(value, "iwm1", {"v": 1, "p": "iwhalecloud", "a": self._account.account_id,
            "e": self._account.email.strip().lower(), "o": "message"}, self._locator_key)
        if set(data) != {"v", "p", "a", "e", "o", "i", "c"} or not _ID.fullmatch(data.get("i", "")) or not _ID.fullmatch(data.get("c", "")):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return data

    def encode_attachment_locator(self, item_id: str, change_key: str, attachment_id: str) -> str:
        if not all(_ID.fullmatch(value) for value in (item_id, change_key, attachment_id)):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return sign_locator("iwa1", {"v": 1, "p": "iwhalecloud", "a": self._account.account_id,
            "e": self._account.email.strip().lower(), "o": "attachment", "i": item_id, "c": change_key, "x": attachment_id}, self._locator_key)

    def _attachment_locator(self, value: str, message: dict[str, Any]) -> dict[str, Any]:
        data = verify_locator(value, "iwa1", {"v": 1, "p": "iwhalecloud", "a": self._account.account_id,
            "e": self._account.email.strip().lower(), "o": "attachment", "i": message["i"], "c": message["c"]}, self._locator_key)
        if set(data) != {"v", "p", "a", "e", "o", "i", "c", "x"} or not _ID.fullmatch(data.get("x", "")):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return data

    def _items_page(self, raw: bytes, operation: str, request_limit: int, cursor_context: dict[str, Any]) -> Page:
        response = _response(parse_xml(raw), operation)
        root_folder = response.find(f"{{{M}}}RootFolder")
        if root_folder is None:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        nodes = root_folder.findall(f".//{{{T}}}Message")
        if len(nodes) > min(request_limit, MAX_ITEMS):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        items = tuple(self._summary(node) for node in nodes)
        complete = root_folder.get("IncludesLastItemInRange")
        if complete not in {"true", "false"}:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        next_cursor = None
        if complete == "false":
            try: offset = int(root_folder.get("IndexedPagingOffset", ""))
            except ValueError as exc: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            next_cursor = _encode("ewc1", {"v": 1, "a": self._account.account_id, "o": offset, **cursor_context})
        return Page(items, next_cursor)

    def _summary(self, node: ET.Element) -> MessageSummary:
        item = node.find(f"{{{T}}}ItemId")
        if item is None:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        locator = self.encode_message_locator(item.get("Id", ""), item.get("ChangeKey", ""))
        sender = _text(node.find(f".//{{{T}}}From/{{{T}}}Mailbox/{{{T}}}EmailAddress"), maximum=4096)
        received = _text(node.find(f"{{{T}}}DateTimeReceived"), maximum=256)
        has = _text(node.find(f"{{{T}}}HasAttachments"), maximum=8)
        if has not in {None, "true", "false"}: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return MessageSummary(locator, _text(node.find(f"{{{T}}}Subject"), optional=False) or "", sender, received,
                              _text(node.find(f"{{{T}}}Preview")), has == "true")

    def _offset(self, cursor: str | None, context: dict[str, Any]) -> int:
        if cursor is None: return 0
        keys = {"v", "a", "o", *context.keys()}
        data = _decode(cursor, "ewc1", keys)
        if data.get("a") != self._account.account_id or any(data.get(k) != v for k, v in context.items()) or type(data.get("o")) is not int or not 0 <= data["o"] <= 1_000_000:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return data["o"]

    def list_messages(self, request: ListRequest) -> Page:
        self._ensure_mailbox()
        if not 1 <= request.limit <= MAX_ITEMS or request.folder not in {"inbox", "sent", "drafts", "trash"}:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        distinguished = {"inbox": "inbox", "sent": "sentitems", "drafts": "drafts", "trash": "deleteditems"}[request.folder]
        offset = self._offset(request.cursor, {"f": request.folder})
        body = f'<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>' \
               f'<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="message:From"/>' \
               f'<t:FieldURI FieldURI="item:HasAttachments"/><t:FieldURI FieldURI="item:Preview"/></t:AdditionalProperties></m:ItemShape>' \
               f'<m:IndexedPageItemView MaxEntriesReturned="{request.limit}" Offset="{offset}" BasePoint="Beginning"/>' \
               f'<m:ParentFolderIds>{self._distinguished(distinguished)}</m:ParentFolderIds></m:FindItem>'
        return self._items_page(self._transport.request("FindItem", _soap(body)), "FindItem", request.limit, {"f": request.folder})

    def search_messages(self, request: SearchRequest) -> Page:
        self._ensure_mailbox()
        query = request.query.strip()
        if not query or len(query) > 1024 or not 1 <= request.limit <= MAX_ITEMS:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        offset = self._offset(request.cursor, {"q": query})
        body = f'<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>' \
               f'<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="message:From"/>' \
               f'<t:FieldURI FieldURI="item:HasAttachments"/><t:FieldURI FieldURI="item:Preview"/></t:AdditionalProperties></m:ItemShape>' \
               f'<m:IndexedPageItemView MaxEntriesReturned="{request.limit}" Offset="{offset}" BasePoint="Beginning"/>' \
               f'<m:QueryString>{html.escape(query)}</m:QueryString><m:ParentFolderIds>{self._distinguished("msgfolderroot")}</m:ParentFolderIds></m:FindItem>'
        return self._items_page(self._transport.request("FindItem", _soap(body)), "FindItem", request.limit, {"q": query})

    def get_message(self, message_id: str) -> MessageContent:
        loc = self._message_locator(message_id)
        self._ensure_mailbox()
        body = f'<m:GetItem><m:ItemShape><t:BaseShape>AllProperties</t:BaseShape><t:BodyType>Best</t:BodyType></m:ItemShape>' \
               f'<m:ItemIds><t:ItemId Id="{html.escape(loc["i"])}" ChangeKey="{html.escape(loc["c"])}"/></m:ItemIds></m:GetItem>'
        response = _response(parse_xml(self._transport.request("GetItem", _soap(body))), "GetItem")
        nodes = response.findall(f".//{{{T}}}Message")
        if len(nodes) != 1: raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        node = nodes[0]; item = node.find(f"{{{T}}}ItemId")
        if item is None or item.get("Id") != loc["i"]: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        change_key = item.get("ChangeKey", "")
        stable_id = self.encode_message_locator(loc["i"], change_key)
        recipients = tuple(filter(None, (_text(x, maximum=4096) for x in node.findall(f".//{{{T}}}ToRecipients/{{{T}}}Mailbox/{{{T}}}EmailAddress"))))
        attachments = []
        for att in node.findall(f".//{{{T}}}FileAttachment"):
            if len(attachments) >= MAX_ITEMS: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            aid = att.find(f"{{{T}}}AttachmentId")
            if aid is None or not _ID.fullmatch(aid.get("Id", "")): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            try: size = int(_text(att.find(f"{{{T}}}Size"), maximum=32, optional=False) or "0")
            except ValueError as exc: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            attachments.append(AttachmentMeta(self.encode_attachment_locator(loc["i"], change_key, aid.get("Id", "")),
                                              safe_filename(_text(att.find(f"{{{T}}}Name"), maximum=1024, optional=False) or "attachment"), size,
                                              _text(att.find(f"{{{T}}}ContentType"), maximum=512)))
        body_node = node.find(f"{{{T}}}Body"); body_value = _text(body_node, maximum=10 * 1024 * 1024)
        is_html = body_node is not None and body_node.get("BodyType") == "HTML"
        sender = _text(node.find(f".//{{{T}}}From/{{{T}}}Mailbox/{{{T}}}EmailAddress"), maximum=4096)
        return MessageContent(stable_id, _text(node.find(f"{{{T}}}Subject"), optional=False) or "", sender, recipients,
                              _text(node.find(f"{{{T}}}DateTimeReceived"), maximum=256), None if is_html else body_value,
                              body_value if is_html else None, tuple(attachments))

    def download_attachment(self, request: AttachmentRequest, sink: AttachmentSink) -> AttachmentDownloadResult:
        message = self._message_locator(request.message_id); attachment = self._attachment_locator(request.attachment_id, message)
        self._ensure_mailbox()
        current = self.get_message(request.message_id)
        if not any(meta.attachment_id == request.attachment_id for meta in current.attachments):
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        body = f'<m:GetAttachment><m:AttachmentShape/><m:AttachmentIds><t:AttachmentId Id="{html.escape(attachment["x"])}"/></m:AttachmentIds></m:GetAttachment>'
        response = _response(parse_xml(self._transport.request("GetAttachment", _soap(body))), "GetAttachment")
        nodes = response.findall(f".//{{{T}}}FileAttachment")
        if len(nodes) != 1: raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        node = nodes[0]; aid = node.find(f"{{{T}}}AttachmentId")
        if aid is None or aid.get("Id") != attachment["x"]: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        encoded = _text(node.find(f"{{{T}}}Content"), maximum=(MAX_ATTACHMENT_BYTES * 4 // 3 + 8), optional=False) or ""
        if len(encoded) > MAX_ATTACHMENT_BYTES * 4 // 3 + 4: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        try: content = base64.b64decode(encoded, validate=True)
        except binascii.Error as exc: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        if len(content) > MAX_ATTACHMENT_BYTES: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        filename = safe_filename(_text(node.find(f"{{{T}}}Name"), maximum=1024, optional=False) or "attachment")
        return sink.write(filename, (content,), content_type=_text(node.find(f"{{{T}}}ContentType"), maximum=512))

    @staticmethod
    def _recipients(name: str, values: tuple[str, ...]) -> str:
        if not values: return ""
        boxes = "".join(f'<t:Mailbox><t:EmailAddress>{html.escape(value)}</t:EmailAddress></t:Mailbox>' for value in values)
        return f"<t:{name}>{boxes}</t:{name}>"

    def _created_locator(self, raw: bytes) -> str:
        try:
            response = _response(parse_xml(raw), "CreateItem")
            ids = response.findall(f".//{{{T}}}ItemId")
            if len(ids) != 1: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            return self.encode_message_locator(ids[0].get("Id", ""), ids[0].get("ChangeKey", ""))
        except MailRuntimeError as exc:
            raise MailRuntimeError(exc.code, retryable=False, ambiguous=True) from exc

    def _send_saved_item(self, locator: str) -> None:
        loc = self._message_locator(locator)
        body = f'<m:SendItem SaveItemToFolder="true"><m:ItemIds><t:ItemId Id="{html.escape(loc["i"])}" ChangeKey="{html.escape(loc["c"])}"/></m:ItemIds>' \
               f'<m:SavedItemFolderId>{self._distinguished("sentitems")}</m:SavedItemFolderId></m:SendItem>'
        try:
            _response(parse_xml(self._transport.request("SendItem", _soap(body), mutation=True)), "SendItem")
        except MailRuntimeError as exc:
            if exc.ambiguous and not exc.retryable: raise
            raise MailRuntimeError(exc.code, retryable=False, ambiguous=True) from exc

    def _send_receipt(self, draft_locator: str) -> str:
        loc = self._message_locator(draft_locator)
        return self.encode_message_locator(loc["i"], loc["c"])

    def send_message(self, draft: Draft) -> SendResult:
        self._ensure_mailbox()
        body_type, content = ("HTML", draft.html) if draft.html is not None else ("Text", draft.text or "")
        message = f'<t:Message><t:Subject>{html.escape(draft.subject)}</t:Subject><t:Body BodyType="{body_type}">{html.escape(content)}</t:Body>' \
                  f'{self._recipients("ToRecipients", draft.to)}{self._recipients("CcRecipients", draft.cc)}{self._recipients("BccRecipients", draft.bcc)}</t:Message>'
        payload = _soap(f'<m:CreateItem MessageDisposition="SaveOnly"><m:SavedItemFolderId>{self._distinguished("drafts")}</m:SavedItemFolderId><m:Items>{message}</m:Items></m:CreateItem>')
        locator = self._created_locator(self._transport.request("CreateItem", payload, mutation=True))
        self._send_saved_item(locator)
        return SendResult(self._send_receipt(locator), draft.to + draft.cc + draft.bcc)

    def reply_message(self, message_id: str, draft: Draft) -> ReplyResult:
        loc = self._message_locator(message_id)
        self._ensure_mailbox()
        body_type, content = ("HTML", draft.html) if draft.html is not None else ("Text", draft.text or "")
        reply = f'<t:ReplyToItem><t:ReferenceItemId Id="{html.escape(loc["i"])}" ChangeKey="{html.escape(loc["c"])}"/><t:NewBodyContent BodyType="{body_type}">{html.escape(content)}</t:NewBodyContent></t:ReplyToItem>'
        result = self._created_locator(self._transport.request("CreateItem", _soap(f'<m:CreateItem MessageDisposition="SaveOnly"><m:SavedItemFolderId>{self._distinguished("drafts")}</m:SavedItemFolderId><m:Items>{reply}</m:Items></m:CreateItem>'), mutation=True))
        self._send_saved_item(result)
        return ReplyResult(self._send_receipt(result))

    def delete_message(self, message_id: str) -> DeleteResult:
        loc = self._message_locator(message_id)
        self._ensure_mailbox()
        body = f'<m:MoveItem><m:ToFolderId>{self._distinguished("deleteditems")}</m:ToFolderId><m:ItemIds>' \
               f'<t:ItemId Id="{html.escape(loc["i"])}" ChangeKey="{html.escape(loc["c"])}"/></m:ItemIds></m:MoveItem>'
        try:
            response = _response(parse_xml(self._transport.request("MoveItem", _soap(body), mutation=True)), "MoveItem")
            ids = response.findall(f".//{{{T}}}ItemId")
            if len(ids) != 1: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            return DeleteResult(self.encode_message_locator(ids[0].get("Id", ""), ids[0].get("ChangeKey", "")))
        except MailRuntimeError as exc:
            if exc.ambiguous and not exc.retryable: raise
            raise MailRuntimeError(exc.code, retryable=False, ambiguous=True) from exc
    def probe_connection(self) -> None:
        self._ensure_mailbox()
