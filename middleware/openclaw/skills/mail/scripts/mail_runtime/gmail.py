from __future__ import annotations

import base64
import binascii
import hashlib
import json
import random
import re
import shlex
import socket
import ssl
import time
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import format_datetime, getaddresses, make_msgid, parsedate_to_datetime
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from .imap_smtp import _strict_address
from .io_security import AttachmentSink
from .mime import safe_filename
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
)
from .registry import AdapterRegistry


API_ORIGIN = "https://gmail.googleapis.com"
API_PREFIX = "/gmail/v1/users/me"
DEFAULT_TIMEOUT = 20.0
MAX_PAGE_SIZE = 100
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_MESSAGE_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_ATTACHMENT_RESPONSE_BYTES = 36 * 1024 * 1024
MAX_BODY_BYTES = 5 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
MAX_OUTBOUND_BYTES = 25 * 1024 * 1024
MAX_PARTS = 500
MAX_DEPTH = 30
MAX_HEADERS = 200
MAX_HEADER_BYTES = 256 * 1024
MAX_RECIPIENTS = 100
MAX_RETRIES = 2
MAX_RETRY_AFTER = 5.0
MAX_ERROR_RESPONSE_BYTES = 64 * 1024
_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_TOKEN = re.compile(r"(?:gc1|ga1)\.[A-Za-z0-9_-]{2,4096}\Z")
_MSG_ATOM = r"[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+"
_MESSAGE_ID = re.compile(rf"<{_MSG_ATOM}(?:\.{_MSG_ATOM})*@{_MSG_ATOM}(?:\.{_MSG_ATOM})*>\Z")
_MIME_TYPE = re.compile(r"[A-Za-z0-9!#$&^_.+-]{1,127}/[A-Za-z0-9!#$&^_.+-]{1,127}\Z")
_PART_ID = re.compile(r"[A-Za-z0-9._-]{0,256}\Z")
_SEARCH_KEYS = {"from", "to", "subject", "text", "after", "before", "is", "has"}
_SHORT_RATE_REASONS = {"ratelimitexceeded", "userratelimitexceeded"}
_PERMISSION_REASONS = {
    "domainpolicy",
    "forbidden",
    "insufficientpermissions",
    "permissiondenied",
}


class _Response(Protocol):
    status: int
    headers: Mapping[str, str]

    def read(self, amount: int = -1) -> bytes: ...
    def close(self) -> None: ...


class _HttpClient(Protocol):
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes | None,
        timeout: float,
    ) -> _Response: ...


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class UrllibGmailHttpClient:
    def __init__(self, *, ssl_context_factory: Callable[[], ssl.SSLContext] = ssl.create_default_context) -> None:
        self._opener = build_opener(_NoRedirect(), HTTPSHandler(context=ssl_context_factory()))

    def request(self, method, url, *, headers, body, timeout):
        request = Request(url, data=body, headers=dict(headers), method=method)
        try:
            return self._opener.open(request, timeout=timeout)
        except HTTPError as response:
            return response


def _safe_id(value: Any) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return value


def _upstream_id(value: Any) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return value


def _page_token(value: Any, error: ErrorCode) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 2048 or any(ord(character) < 33 or ord(character) == 127 for character in value):
        raise MailRuntimeError(error)
    return value


def _b64_decode(value: Any, *, maximum: int) -> bytes:
    if not isinstance(value, str) or len(value) > ((maximum + 2) // 3) * 4 + 4:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    try:
        decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    if len(decoded) > maximum:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return decoded


def _b64_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _encode_token(prefix: str, payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return prefix + "." + _b64_encode(raw)


def _decode_token(value: Any, prefix: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, str) or not _TOKEN.fullmatch(value) or not value.startswith(prefix + "."):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    try:
        raw = _b64_decode(value.split(".", 1)[1], maximum=3072)
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError, MailRuntimeError) as exc:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
    if not isinstance(payload, dict) or set(payload) != keys or payload.get("v") != 1:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    if _encode_token(prefix, payload) != value:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return payload


def _header_text(value: Any, *, maximum: int = 64 * 1024) -> str:
    if not isinstance(value, str) or len(value.encode("utf-8")) > maximum:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    if "\x00" in value:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    try:
        return str(make_header(decode_header(value)))
    except (LookupError, UnicodeError, ValueError, TypeError) as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc


def _headers(payload: Mapping[str, Any]) -> dict[str, str]:
    raw = payload.get("headers", [])
    if not isinstance(raw, list) or len(raw) > MAX_HEADERS:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    result: dict[str, str] = {}
    total = 0
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("value"), str):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        name, value = item["name"], item["value"]
        total += len(name.encode("utf-8")) + len(value.encode("utf-8"))
        if total > MAX_HEADER_BYTES or not re.fullmatch(r"[!-9;-~]{1,128}", name):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        result.setdefault(name.casefold(), value)
    return result


def _content_charset(content_type: str) -> str:
    match = re.search(r"(?:^|;)\s*charset\s*=\s*(?:\"([^\"]+)\"|([^;\s]+))", content_type, re.I)
    return (match.group(1) or match.group(2)) if match else "utf-8"


def _decode_text(data: bytes, content_type: str) -> str:
    try:
        text = data.decode(_content_charset(content_type), errors="replace")
    except LookupError:
        text = data.decode("utf-8", errors="replace")
    return text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")


def _parse_date(value: str | None, internal_date: Any) -> str | None:
    if value:
        try:
            return parsedate_to_datetime(value).isoformat()
        except (TypeError, ValueError, OverflowError):
            pass
    if isinstance(internal_date, str) and internal_date.isdigit() and len(internal_date) <= 16:
        try:
            return datetime.fromtimestamp(int(internal_date) / 1000, timezone.utc).isoformat()
        except (ValueError, OverflowError, OSError):
            pass
    return None


def _attachment_locator(
    message_id: str,
    attachment_id: str | None,
    part_id: str,
    filename: str,
    content_type: str,
    size: int,
    representation: str,
) -> str:
    context = {
        "a": attachment_id,
        "ct": content_type,
        "f": filename,
        "m": message_id,
        "p": part_id,
        "r": representation,
        "s": size,
        "v": 1,
    }
    context_hash = hashlib.sha256(
        json.dumps(context, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return _encode_token("ga1", {**context, "c": context_hash})


def _validate_attachment_context(locator: Mapping[str, Any]) -> bool:
    context = {key: locator.get(key) for key in ("a", "ct", "f", "m", "p", "r", "s", "v")}
    expected = hashlib.sha256(
        json.dumps(context, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return locator.get("c") == expected


def _decoded_attachment_chunks(encoded: str, *, maximum: int, expected_size: int) -> Iterable[bytes]:
    if len(encoded) > ((maximum + 2) // 3) * 4 + 4:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    total = 0
    step = 64 * 1024
    carry = ""
    for offset in range(0, len(encoded), step):
        compact = carry + encoded[offset : offset + step]
        ready_length = len(compact) - (len(compact) % 4)
        ready, carry = compact[:ready_length], compact[ready_length:]
        try:
            decoded = base64.b64decode(ready, altchars=b"-_", validate=True) if ready else b""
        except (ValueError, binascii.Error) as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        total += len(decoded)
        if total > maximum:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if decoded:
            yield decoded
    try:
        tail = base64.b64decode(carry + "=" * (-len(carry) % 4), altchars=b"-_", validate=True) if carry else b""
    except (ValueError, binascii.Error) as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    total += len(tail)
    if total > maximum or total != expected_size:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    if tail:
        yield tail


class GmailAdapter:
    def __init__(
        self,
        account: AccountConfig,
        *,
        http_client: _HttpClient | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        sleep: Callable[[float], None] = time.sleep,
        jitter: Callable[[], float] = random.random,
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        auth_type = account.auth.get("type")
        token = account.auth.get("accessToken")
        if not isinstance(auth_type, str) or auth_type.upper() != "OAUTH2" or not isinstance(token, str) or not token.strip():
            raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)
        if len(token) > 16 * 1024 or any(ord(character) < 33 or ord(character) == 127 for character in token):
            raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)
        if not isinstance(timeout, (int, float)) or not 0 < timeout <= DEFAULT_TIMEOUT:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        self._account = account
        self._token = token
        self._http = http_client or UrllibGmailHttpClient()
        self._timeout = float(timeout)
        self._sleep = sleep
        self._jitter = jitter
        self._clock = clock

    def _url(self, path: str, query: Mapping[str, Any] | None = None) -> str:
        if not path.startswith("/") or ".." in path or "?" in path or "#" in path:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        url = API_ORIGIN + API_PREFIX + path
        if query:
            url += "?" + urlencode(query, doseq=True, safe="")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != "gmail.googleapis.com":
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        return url

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        query: Mapping[str, Any] | None = None,
        payload: Mapping[str, Any] | None = None,
        idempotent: bool = False,
        not_found: ErrorCode = ErrorCode.MESSAGE_NOT_FOUND,
        maximum: int = MAX_RESPONSE_BYTES,
    ) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if body is not None and len(body) > MAX_OUTBOUND_BYTES * 2:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        headers = {"Accept": "application/json", "Authorization": "Bearer " + self._token}
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        attempts = MAX_RETRIES + 1 if idempotent else 1
        for attempt in range(attempts):
            response = None
            try:
                response = self._http.request(method, self._url(path, query), headers=headers, body=body, timeout=self._timeout)
                status = response.status
                if status in {429, 500, 502, 503, 504} and idempotent and attempt + 1 < attempts:
                    self._sleep(self._retry_delay(response.headers.get("Retry-After"), attempt))
                    continue
                if status == 401:
                    raise MailRuntimeError(ErrorCode.AUTH_EXPIRED)
                if status == 403:
                    forbidden_code, short_term = self._classify_forbidden(response)
                    if short_term and idempotent and attempt + 1 < attempts:
                        self._sleep(self._retry_delay(response.headers.get("Retry-After"), attempt))
                        continue
                    raise MailRuntimeError(forbidden_code)
                if status == 404:
                    raise MailRuntimeError(not_found)
                if status == 429:
                    raise MailRuntimeError(ErrorCode.RATE_LIMITED)
                if not 200 <= status < 300:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                if content_type != "application/json":
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                raw = response.read(maximum + 1)
                if not isinstance(raw, bytes) or len(raw) > maximum:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                try:
                    value = json.loads(raw.decode("utf-8"))
                except (UnicodeError, json.JSONDecodeError) as exc:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
                if not isinstance(value, dict):
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                return value
            except MailRuntimeError:
                raise
            except (socket.timeout, TimeoutError, ssl.SSLError, URLError, OSError) as exc:
                if idempotent and attempt + 1 < attempts:
                    self._sleep(min(MAX_RETRY_AFTER, 0.25 * (2**attempt) + max(0.0, min(1.0, float(self._jitter())))))
                    continue
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            except Exception as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            finally:
                if response is not None:
                    try:
                        response.close()
                    except Exception:
                        pass
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)

    def _classify_forbidden(self, response: _Response) -> tuple[ErrorCode, bool]:
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return ErrorCode.PERMISSION_DENIED, False
        raw = response.read(MAX_ERROR_RESPONSE_BYTES + 1)
        if not isinstance(raw, bytes) or len(raw) > MAX_ERROR_RESPONSE_BYTES:
            return ErrorCode.PERMISSION_DENIED, False
        try:
            document = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            return ErrorCode.PERMISSION_DENIED, False
        if not isinstance(document, dict) or not isinstance(document.get("error"), dict):
            return ErrorCode.PERMISSION_DENIED, False
        error = document["error"]
        status = error.get("status")
        reasons: list[str] = []
        entries = error.get("errors", [])
        if not isinstance(entries, list) or len(entries) > 20:
            return ErrorCode.PERMISSION_DENIED, False
        for entry in entries:
            if not isinstance(entry, dict):
                return ErrorCode.PERMISSION_DENIED, False
            reason = entry.get("reason")
            if reason is None:
                continue
            if not isinstance(reason, str) or not 1 <= len(reason) <= 128 or any(ord(c) < 33 or ord(c) == 127 for c in reason):
                return ErrorCode.PERMISSION_DENIED, False
            reasons.append(reason.casefold())
        if any(reason in _PERMISSION_REASONS for reason in reasons) or status == "PERMISSION_DENIED":
            return ErrorCode.PERMISSION_DENIED, False
        short_term = any(reason in _SHORT_RATE_REASONS for reason in reasons)
        rate_limited = short_term or status == "RESOURCE_EXHAUSTED" or any(
            "quota" in reason or "ratelimit" in reason or "dailylimit" in reason for reason in reasons
        )
        if rate_limited:
            return ErrorCode.RATE_LIMITED, short_term
        return ErrorCode.PERMISSION_DENIED, False

    def _retry_delay(self, value: Any, attempt: int) -> float:
        try:
            delay = float(value)
        except (TypeError, ValueError):
            try:
                retry_at = parsedate_to_datetime(value)
                now = self._clock()
                if retry_at.tzinfo is None or not isinstance(now, datetime) or now.tzinfo is None:
                    raise ValueError
                delay = (retry_at - now).total_seconds()
            except (TypeError, ValueError, OverflowError):
                delay = 0.25 * (2**attempt)
        jitter = max(0.0, min(1.0, float(self._jitter())))
        return min(MAX_RETRY_AFTER, max(0.0, delay) + jitter)

    def _message(self, message_id: str, *, format_name: str = "full") -> dict[str, Any]:
        message_id = _safe_id(message_id)
        value = self._request_json(
            "GET", f"/messages/{quote(message_id, safe='')}", query={"format": format_name},
            idempotent=True, maximum=MAX_MESSAGE_RESPONSE_BYTES,
        )
        if _upstream_id(value.get("id")) != message_id:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        _upstream_id(value.get("threadId"))
        if not isinstance(value.get("payload"), dict):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return value

    def _summary(self, value: Mapping[str, Any]) -> MessageSummary:
        message_id = _upstream_id(value.get("id"))
        payload = value.get("payload")
        if not isinstance(payload, dict):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        headers = _headers(payload)
        snippet = value.get("snippet")
        if snippet is not None and (not isinstance(snippet, str) or len(snippet) > 64 * 1024):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return MessageSummary(
            message_id=message_id,
            subject=_header_text(headers.get("subject", "")),
            sender=_header_text(headers["from"]) if "from" in headers else None,
            received_at=_parse_date(headers.get("date"), value.get("internalDate")),
            preview=snippet,
            has_attachments=self._has_attachment(payload),
        )

    def _has_attachment(self, root: Mapping[str, Any]) -> bool:
        for part, _depth in self._walk(root):
            filename = part.get("filename")
            body = part.get("body", {})
            if (
                isinstance(filename, str)
                and filename
                and isinstance(body, dict)
                and (body.get("attachmentId") is not None or isinstance(body.get("data"), str))
            ):
                return True
        return False

    def _walk(self, root: Mapping[str, Any]) -> Iterable[tuple[Mapping[str, Any], int]]:
        stack: list[tuple[Mapping[str, Any], int]] = [(root, 0)]
        count = 0
        while stack:
            part, depth = stack.pop()
            count += 1
            if count > MAX_PARTS or depth > MAX_DEPTH:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            if not isinstance(part, dict):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            yield part, depth
            children = part.get("parts", [])
            if not isinstance(children, list):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            for child in reversed(children):
                if not isinstance(child, dict):
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                stack.append((child, depth + 1))

    def _page(
        self,
        request: ListRequest | SearchRequest,
        query: Mapping[str, Any],
        *,
        operation: str,
        context: Mapping[str, str],
    ) -> Page:
        if type(request.limit) is not int or not 1 <= request.limit <= MAX_PAGE_SIZE:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        parameters = dict(query)
        parameters["maxResults"] = request.limit
        context_json = json.dumps(
            {"operation": operation, **dict(context)}, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        context_hash = hashlib.sha256(context_json).hexdigest()
        if request.cursor is not None:
            cursor = _decode_token(request.cursor, "gc1", {"a", "c", "o", "p", "v"})
            if (
                cursor.get("a") != self._account.account_id
                or cursor.get("o") != operation
                or cursor.get("c") != context_hash
            ):
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            page_token = cursor.get("p")
            parameters["pageToken"] = _page_token(page_token, ErrorCode.INVALID_REQUEST)
        value = self._request_json("GET", "/messages", query=parameters, idempotent=True)
        raw_messages = value.get("messages", [])
        if not isinstance(raw_messages, list) or len(raw_messages) > request.limit:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        items: list[MessageSummary] = []
        for raw in raw_messages:
            if not isinstance(raw, dict):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            message_id = _upstream_id(raw.get("id"))
            items.append(self._summary(self._message(message_id, format_name="metadata")))
        next_page = value.get("nextPageToken")
        if next_page is not None:
            next_page = _page_token(next_page, ErrorCode.UPSTREAM_UNAVAILABLE)
        cursor = _encode_token(
            "gc1",
            {"a": self._account.account_id, "c": context_hash, "o": operation, "p": next_page, "v": 1},
        ) if next_page else None
        return Page(tuple(items), cursor)

    def probe_connection(self) -> None:
        self._request_json("GET", "/profile", idempotent=True, maximum=64 * 1024)

    def list_messages(self, request: ListRequest) -> Page:
        if request.folder.casefold() != "inbox":
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return self._page(
            request,
            {"labelIds": "INBOX"},
            operation="list",
            context={"folder": "inbox", "label": "INBOX"},
        )

    def get_message(self, message_id: str) -> MessageContent:
        value = self._message(message_id)
        payload = value["payload"]
        headers = _headers(payload)
        text = None
        html = None
        decoded_total = 0
        attachments: list[AttachmentMeta] = []
        external_body_ids: set[str] = set()
        external_body_fetches = 0
        for part, _depth in self._walk(payload):
            mime_type = part.get("mimeType")
            filename = part.get("filename", "")
            part_id = part.get("partId", "")
            body = part.get("body", {})
            if not isinstance(mime_type, str) or not _MIME_TYPE.fullmatch(mime_type) or not isinstance(filename, str) or len(filename) > 1024 or not isinstance(part_id, str) or not _PART_ID.fullmatch(part_id) or not isinstance(body, dict):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            size = body.get("size", 0)
            part_limit = MAX_BODY_BYTES if not filename and mime_type in {"text/plain", "text/html"} else MAX_ATTACHMENT_BYTES
            if type(size) is not int or size < 0 or size > part_limit:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            attachment_id = body.get("attachmentId")
            if filename and (attachment_id is not None or isinstance(body.get("data"), str)):
                try:
                    filename = safe_filename(filename)
                except MailRuntimeError as exc:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
                if attachment_id is not None:
                    attachment_id = _upstream_id(attachment_id)
                    representation = "external"
                else:
                    attachment_id = None
                    representation = "inline"
                    if len(body["data"]) > ((MAX_ATTACHMENT_BYTES + 2) // 3) * 4 + 4:
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                locator = _attachment_locator(
                    value["id"], attachment_id, part_id, filename, mime_type, size, representation
                )
                attachments.append(AttachmentMeta(locator, filename, size, mime_type))
                continue
            data = body.get("data")
            if mime_type not in {"text/plain", "text/html"}:
                continue
            if attachment_id is not None:
                attachment_id = _upstream_id(attachment_id)
                if attachment_id in external_body_ids:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                external_body_ids.add(attachment_id)
            if (mime_type == "text/plain" and text is not None) or (mime_type == "text/html" and html is not None):
                continue
            if data is None and attachment_id is not None:
                if external_body_fetches >= 2:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                external_body_fetches += 1
                external = self._request_json(
                    "GET",
                    f"/messages/{quote(value['id'], safe='')}/attachments/{quote(attachment_id, safe='')}",
                    idempotent=True,
                    not_found=ErrorCode.MESSAGE_NOT_FOUND,
                    maximum=MAX_MESSAGE_RESPONSE_BYTES,
                )
                if external.get("size") != size:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                data = external.get("data")
            if data is None:
                continue
            decoded = _b64_decode(data, maximum=min(MAX_BODY_BYTES, size if size else MAX_BODY_BYTES))
            if len(decoded) != size:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            decoded_total += len(decoded)
            if decoded_total > MAX_BODY_BYTES:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            content_type = _headers(part).get("content-type", mime_type)
            rendered = _decode_text(decoded, content_type)
            if mime_type == "text/plain" and text is None:
                text = rendered
            elif mime_type == "text/html" and html is None:
                html = rendered
        recipients = tuple(value for _name, value in getaddresses([headers.get("to", ""), headers.get("cc", "")]) if value)
        return MessageContent(
            message_id=value["id"],
            subject=_header_text(headers.get("subject", "")),
            sender=_header_text(headers["from"]) if "from" in headers else None,
            recipients=recipients,
            received_at=_parse_date(headers.get("date"), value.get("internalDate")),
            text=text,
            html=html,
            attachments=tuple(attachments),
        )

    def _search_query(self, query: str) -> str:
        if not isinstance(query, str) or not query or len(query) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in query):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        try:
            tokens = shlex.split(query, posix=True)
        except ValueError as exc:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
        if not tokens or len(tokens) > 32:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        output: list[str] = []
        for token in tokens:
            if ":" in token:
                key, value = token.split(":", 1)
                key = key.casefold()
            else:
                key, value = "text", token
            if key not in _SEARCH_KEYS or not value or len(value) > 1024 or any(character in value for character in "{}()\r\n"):
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            if key in {"from", "to", "subject", "text"}:
                escaped = value.replace("\\", "\\\\").replace('"', '\\"')
                prefix = "" if key == "text" else key + ":"
                output.append(prefix + '"' + escaped + '"')
            elif key in {"after", "before"}:
                try:
                    parsed = datetime.strptime(value, "%Y-%m-%d")
                except ValueError as exc:
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
                output.append(f"{key}:{parsed:%Y/%m/%d}")
            elif key == "is" and value.casefold() == "unread":
                output.append("is:unread")
            elif key == "has" and value.casefold() == "attachment":
                output.append("has:attachment")
            else:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        compiled = " ".join(output)
        if len(compiled) > 4096:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return compiled

    def search_messages(self, request: SearchRequest) -> Page:
        compiled = self._search_query(request.query)
        return self._page(
            request,
            {"q": compiled},
            operation="search",
            context={"query": compiled},
        )

    def download_attachment(self, request: AttachmentRequest, sink: AttachmentSink) -> AttachmentDownloadResult:
        message_id = _safe_id(request.message_id)
        try:
            locator = _decode_token(
                request.attachment_id,
                "ga1",
                {"a", "c", "ct", "f", "m", "p", "r", "s", "v"},
            )
        except MailRuntimeError as exc:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND) from exc
        if locator.get("m") != message_id or not _validate_attachment_context(locator):
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        attachment_id = locator.get("a")
        filename = locator.get("f")
        content_type = locator.get("ct")
        part_id = locator.get("p")
        expected_size = locator.get("s")
        representation = locator.get("r")
        if not isinstance(part_id, str) or not _PART_ID.fullmatch(part_id) or not isinstance(filename, str) or not filename or len(filename) > 240 or not isinstance(content_type, str) or not _MIME_TYPE.fullmatch(content_type) or type(expected_size) is not int or not 0 <= expected_size <= MAX_ATTACHMENT_BYTES or representation not in {"external", "inline"}:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        if representation == "external":
            if not isinstance(attachment_id, str) or not _ID.fullmatch(attachment_id):
                raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
            value = self._request_json(
                "GET", f"/messages/{quote(message_id, safe='')}/attachments/{quote(attachment_id, safe='')}",
                idempotent=True, not_found=ErrorCode.ATTACHMENT_NOT_FOUND, maximum=MAX_ATTACHMENT_RESPONSE_BYTES,
            )
            size = value.get("size")
            encoded = value.get("data")
            if type(size) is not int or size != expected_size or not isinstance(encoded, str):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        else:
            if attachment_id is not None:
                raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
            try:
                message = self._message(message_id)
            except MailRuntimeError as exc:
                if exc.code == ErrorCode.MESSAGE_NOT_FOUND:
                    raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND) from exc
                raise
            matches = [part for part, _depth in self._walk(message["payload"]) if part.get("partId") == part_id]
            if len(matches) != 1:
                raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
            part = matches[0]
            body = part.get("body")
            actual_filename = part.get("filename")
            if (
                not isinstance(body, dict)
                or body.get("attachmentId") is not None
                or part.get("mimeType") != content_type
                or actual_filename != filename
                or body.get("size") != expected_size
                or not isinstance(body.get("data"), str)
            ):
                raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
            try:
                if safe_filename(actual_filename) != filename:
                    raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
            except MailRuntimeError as exc:
                raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND) from exc
            encoded = body["data"]
        return sink.write(
            filename,
            _decoded_attachment_chunks(encoded, maximum=MAX_ATTACHMENT_BYTES, expected_size=expected_size),
            content_type=content_type,
        )

    def _outbound(self, draft: Draft, *, reply_headers: Mapping[str, str] | None = None) -> tuple[bytes, tuple[str, ...]]:
        recipients = draft.to + draft.cc + draft.bcc
        if not recipients or len(recipients) > MAX_RECIPIENTS:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        parsed: dict[str, tuple[Any, ...]] = {}
        envelope: list[str] = []
        for name, values in (("to", draft.to), ("cc", draft.cc), ("bcc", draft.bcc)):
            addresses = tuple(_strict_address(item) for item in values)
            parsed[name] = tuple(item[0] for item in addresses)
            envelope.extend(item[1] for item in addresses)
        sender, sender_addr = _strict_address(self._account.email)
        message = EmailMessage(policy=policy.SMTP)
        message["From"] = sender
        if parsed["to"]:
            message["To"] = list(parsed["to"])
        if parsed["cc"]:
            message["Cc"] = list(parsed["cc"])
        if parsed["bcc"]:
            message["Bcc"] = list(parsed["bcc"])
        message["Subject"] = draft.subject
        now = self._clock()
        if not isinstance(now, datetime) or now.tzinfo is None:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        message["Date"] = format_datetime(now)
        message["Message-ID"] = make_msgid(domain=sender_addr.split("@", 1)[1])
        if reply_headers:
            for name in ("In-Reply-To", "References"):
                if name in reply_headers:
                    message[name] = reply_headers[name]
        if draft.text is not None:
            message.set_content(draft.text)
            if draft.html is not None:
                message.add_alternative(draft.html, subtype="html")
        elif draft.html is not None:
            message.set_content(draft.html, subtype="html")
        raw = message.as_bytes()
        if len(raw) > MAX_OUTBOUND_BYTES:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return raw, tuple(envelope)

    def _send(self, draft: Draft, *, thread_id: str | None = None, reply_headers: Mapping[str, str] | None = None, reply: bool = False):
        raw, recipients = self._outbound(draft, reply_headers=reply_headers)
        payload: dict[str, Any] = {"raw": _b64_encode(raw)}
        if thread_id is not None:
            payload["threadId"] = _safe_id(thread_id)
        value = self._request_json("POST", "/messages/send", payload=payload)
        message_id = _upstream_id(value.get("id"))
        response_thread_id = _upstream_id(value.get("threadId"))
        if thread_id is not None and response_thread_id != thread_id:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        result_type = ReplyResult if reply else SendResult
        return result_type(message_id, recipients, (), False)

    def send_message(self, draft: Draft) -> SendResult:
        return self._send(draft)

    def reply_message(self, message_id: str, draft: Draft) -> ReplyResult:
        original = self._message(message_id)
        headers = _headers(original["payload"])
        original_id = headers.get("message-id")
        if not isinstance(original_id, str) or len(original_id) > 998 or not _MESSAGE_ID.fullmatch(original_id):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        references = headers.get("references", "")
        reference_ids = references.split() if references else []
        if references and (
            len(references) > 4096
            or len(reference_ids) > 50
            or not all(len(item) <= 998 and _MESSAGE_ID.fullmatch(item) for item in reference_ids)
        ):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if not draft.to:
            target = headers.get("reply-to") or headers.get("from")
            try:
                _address, target_addr = _strict_address(target)
            except MailRuntimeError as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            draft = Draft((target_addr,), draft.cc, draft.bcc, draft.subject, draft.text, draft.html)
        subject = draft.subject or _header_text(headers.get("subject", ""))
        if not subject.casefold().startswith("re:"):
            subject = "Re: " + subject
        if len(subject) > 998 or "\r" in subject or "\n" in subject:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        draft = Draft(draft.to, draft.cc, draft.bcc, subject, draft.text, draft.html)
        reply_headers = {
            "In-Reply-To": original_id,
            "References": " ".join((*reference_ids, original_id)),
        }
        return self._send(draft, thread_id=original["threadId"], reply_headers=reply_headers, reply=True)

    def delete_message(self, message_id: str) -> DeleteResult:
        message_id = _safe_id(message_id)
        value = self._request_json("POST", f"/messages/{quote(message_id, safe='')}/trash", payload={})
        if _upstream_id(value.get("id")) != message_id:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        _upstream_id(value.get("threadId"))
        return DeleteResult(message_id, "trash")


def register_gmail(registry: AdapterRegistry) -> None:
    registry.register("gmail", GmailAdapter)
