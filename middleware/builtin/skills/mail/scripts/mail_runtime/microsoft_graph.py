from __future__ import annotations

import base64
import binascii
import hashlib
import json
import random
import re
import socket
import ssl
import time
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlsplit
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


API_ORIGIN = "https://graph.microsoft.com"
API_PREFIX = "/v1.0"
DEFAULT_TIMEOUT = 20.0
MAX_PAGE_SIZE = 100
MAX_RETRIES = 2
MAX_RETRY_AFTER = 5.0
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_MESSAGE_BYTES = 8 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
MAX_ATTACHMENT_RESPONSE_BYTES = 36 * 1024 * 1024
MAX_OUTBOUND_BYTES = 10 * 1024 * 1024
MAX_HEADERS = 200
MAX_HEADER_BYTES = 256 * 1024
MAX_RECIPIENTS = 100
MAX_ATTACHMENTS = 200
MAX_ATTACHMENT_PAGES = 200
_ID = re.compile(r"[A-Za-z0-9._~+/=-]{1,1024}\Z")
_TOKEN = re.compile(r"(?:mc1|ma1)\.[A-Za-z0-9_-]{2,16384}\Z")
_MIME = re.compile(r"[A-Za-z0-9!#$&^_.+-]{1,127}/[A-Za-z0-9!#$&^_.+-]{1,127}\Z")
_NEXT_PARAMETERS = {"$select", "$filter", "$search", "$orderby", "$top", "$skip", "$skiptoken"}
_MESSAGE_SELECT = "id,subject,bodyPreview,receivedDateTime,from,hasAttachments"
_MESSAGE_DETAIL_SELECT = (
    _MESSAGE_SELECT
    + ",conversationId,parentFolderId,toRecipients,ccRecipients,bccRecipients,isRead,body,internetMessageHeaders"
)
_LIST_PATH = "/me/mailFolders/inbox/messages"
_SAFE_SEARCH_KEYS = {"from", "to", "subject", "body", "text", "after", "before", "is", "has"}
_THROTTLE_CODES = {"activitylimitreached", "applicationthrottled", "errorquotaexceeded", "throttledrequest", "toomanyrequests"}
_TRANSIENT_THROTTLE_CODES = {"applicationthrottled", "throttledrequest", "toomanyrequests"}


class _GraphRequestFailure(MailRuntimeError):
    def __init__(self, code: ErrorCode, status: int, *, ambiguous: bool = False) -> None:
        super().__init__(code, retryable=False if ambiguous else None, ambiguous=ambiguous)
        self.status = status


class _Response(Protocol):
    status: int
    headers: Mapping[str, str]

    def read(self, amount: int = -1) -> bytes: ...
    def close(self) -> None: ...


class _HttpClient(Protocol):
    def request(self, method: str, url: str, *, headers: Mapping[str, str], body: bytes | None, timeout: float) -> _Response: ...


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class UrllibMicrosoftGraphHttpClient:
    def __init__(self, *, ssl_context_factory: Callable[[], ssl.SSLContext] = ssl.create_default_context) -> None:
        self._opener = build_opener(_NoRedirect(), HTTPSHandler(context=ssl_context_factory()))

    def request(self, method, url, *, headers, body, timeout):
        request = Request(url, data=body, headers=dict(headers), method=method)
        try:
            return self._opener.open(request, timeout=timeout)
        except HTTPError as response:
            return response


def _safe_id(value: Any, *, upstream: bool = False) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE if upstream else ErrorCode.INVALID_REQUEST)
    return value


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: Any, maximum: int, *, code: ErrorCode) -> bytes:
    if not isinstance(value, str) or len(value) > ((maximum + 2) // 3) * 4 + 4:
        raise MailRuntimeError(code)
    try:
        decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as exc:
        raise MailRuntimeError(code) from exc
    if len(decoded) > maximum:
        raise MailRuntimeError(code)
    return decoded


def _token(prefix: str, payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return prefix + "." + _b64encode(raw)


def _untoken(value: Any, prefix: str, keys: set[str], *, code: ErrorCode) -> dict[str, Any]:
    if not isinstance(value, str) or not _TOKEN.fullmatch(value) or not value.startswith(prefix + "."):
        raise MailRuntimeError(code)
    try:
        document = json.loads(_b64decode(value.split(".", 1)[1], 12 * 1024, code=code).decode())
    except (UnicodeError, json.JSONDecodeError, MailRuntimeError) as exc:
        raise MailRuntimeError(code) from exc
    if not isinstance(document, dict) or set(document) != keys or document.get("v") != 1 or _token(prefix, document) != value:
        raise MailRuntimeError(code)
    return document


def _text(value: Any, maximum: int, *, optional: bool = False) -> str | None:
    if value is None and optional:
        return None
    if not isinstance(value, str) or len(value.encode("utf-8")) > maximum or "\x00" in value:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return value.replace("\r\n", "\n").replace("\r", "\n")


def _address(value: Any) -> str:
    if not isinstance(value, dict) or not isinstance(value.get("emailAddress"), dict):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    raw = value["emailAddress"].get("address")
    if not isinstance(raw, str):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    try:
        return _strict_address(raw)[1]
    except MailRuntimeError as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc


def _addresses(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) > MAX_RECIPIENTS:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return tuple(_address(item) for item in value)


def _sender(value: Any) -> str | None:
    if value is None:
        return None
    address = _address(value)
    email_address = value["emailAddress"]
    name = email_address.get("name")
    if name is None or name == "":
        return address
    name = _text(name, 1024)
    return f"{name} <{address}>"


def _chunks(encoded: Any, *, expected: int) -> Iterable[bytes]:
    if not isinstance(encoded, str) or expected < 0 or expected > MAX_ATTACHMENT_BYTES:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    if len(encoded) > ((expected + 2) // 3) * 4 + 4:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    carry = ""
    total = 0
    try:
        for start in range(0, len(encoded), 64 * 1024):
            carry += encoded[start : start + 64 * 1024]
            boundary = (len(carry) // 4) * 4
            if boundary:
                decoded = base64.b64decode(carry[:boundary], validate=True)
                carry = carry[boundary:]
                total += len(decoded)
                if total > expected:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                if decoded:
                    yield decoded
        decoded = base64.b64decode(carry + "=" * (-len(carry) % 4), validate=True) if carry else b""
    except (ValueError, binascii.Error) as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    total += len(decoded)
    if total != expected:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    if decoded:
        yield decoded


class MicrosoftGraphAdapter:
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
        self._http = http_client or UrllibMicrosoftGraphHttpClient()
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
        if parsed.scheme != "https" or parsed.hostname != "graph.microsoft.com" or parsed.port is not None:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        return url

    def _error_code(self, response: _Response, status: int) -> tuple[ErrorCode, bool]:
        if status == 401:
            return ErrorCode.AUTH_EXPIRED, False
        if status == 404:
            return ErrorCode.MESSAGE_NOT_FOUND, False
        if status == 429:
            return ErrorCode.RATE_LIMITED, True
        if status != 403:
            return ErrorCode.UPSTREAM_UNAVAILABLE, False
        try:
            if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                return ErrorCode.PERMISSION_DENIED, False
            raw = response.read(64 * 1024 + 1)
            document = json.loads(raw.decode()) if len(raw) <= 64 * 1024 else None
            code = document.get("error", {}).get("code") if isinstance(document, dict) else None
            if isinstance(code, str) and code.casefold() in _THROTTLE_CODES:
                normalized = code.casefold()
                return ErrorCode.RATE_LIMITED, normalized in _TRANSIENT_THROTTLE_CODES
        except Exception:
            pass
        return ErrorCode.PERMISSION_DENIED, False

    def _delay(self, value: Any, attempt: int) -> float:
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
        try:
            jitter = max(0.0, min(1.0, float(self._jitter())))
        except Exception:
            jitter = 0.0
        return min(MAX_RETRY_AFTER, max(0.0, delay) + jitter)

    def _invalid_success_response(self, idempotent: bool) -> MailRuntimeError:
        return MailRuntimeError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            retryable=False if not idempotent else None,
            ambiguous=not idempotent,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Mapping[str, Any] | None = None,
        payload: Mapping[str, Any] | None = None,
        maximum: int = MAX_RESPONSE_BYTES,
        not_found: ErrorCode = ErrorCode.MESSAGE_NOT_FOUND,
        expect_json: bool = True,
        extra_headers: Mapping[str, str] | None = None,
        budget: list[int] | None = None,
    ) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        if body is not None and len(body) > MAX_OUTBOUND_BYTES:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        headers = {
            "Accept": "application/json",
            "Authorization": "Bearer " + self._token,
            "Prefer": 'IdType="ImmutableId"',
        }
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        if extra_headers:
            headers.update(extra_headers)
        idempotent = method == "GET"
        attempts = MAX_RETRIES + 1 if idempotent else 1
        for attempt in range(attempts):
            response = None
            try:
                response = self._http.request(method, self._url(path, query), headers=headers, body=body, timeout=self._timeout)
                status = response.status
                if status in {429, 500, 502, 503, 504} and idempotent and attempt + 1 < attempts:
                    self._sleep(self._delay(response.headers.get("Retry-After"), attempt))
                    continue
                if not 200 <= status < 300:
                    code, transient = self._error_code(response, status)
                    if status == 403 and transient and idempotent and attempt + 1 < attempts:
                        self._sleep(self._delay(response.headers.get("Retry-After"), attempt))
                        continue
                    if status == 404:
                        code = not_found
                    ambiguous = not idempotent and status >= 500
                    raise _GraphRequestFailure(code, status, ambiguous=ambiguous)
                if not expect_json:
                    return {}
                if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    raise self._invalid_success_response(idempotent)
                allowed = min(maximum, budget[0]) if budget is not None else maximum
                if allowed < 0:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                raw = response.read(allowed + 1)
                if not isinstance(raw, bytes) or len(raw) > allowed:
                    raise self._invalid_success_response(idempotent)
                if budget is not None:
                    budget[0] -= len(raw)
                try:
                    value = json.loads(raw.decode("utf-8"))
                except (UnicodeError, json.JSONDecodeError) as exc:
                    raise self._invalid_success_response(idempotent) from exc
                if not isinstance(value, dict):
                    raise self._invalid_success_response(idempotent)
                return value
            except MailRuntimeError:
                raise
            except (socket.timeout, TimeoutError, ssl.SSLError, URLError, OSError) as exc:
                if idempotent and attempt + 1 < attempts:
                    self._sleep(self._delay(None, attempt))
                    continue
                if not idempotent:
                    raise MailRuntimeError(
                        ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True
                    ) from exc
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            except Exception as exc:
                if not idempotent:
                    raise MailRuntimeError(
                        ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True
                    ) from exc
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            finally:
                if response is not None:
                    try:
                        response.close()
                    except Exception:
                        pass
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)

    def _summary(self, value: Any) -> MessageSummary:
        if not isinstance(value, dict):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        has_attachments = value.get("hasAttachments")
        if type(has_attachments) is not bool:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return MessageSummary(
            _safe_id(value.get("id"), upstream=True),
            _text(value.get("subject", ""), 64 * 1024) or "",
            _sender(value.get("from")),
            _text(value.get("receivedDateTime"), 256, optional=True),
            _text(value.get("bodyPreview"), 64 * 1024, optional=True),
            has_attachments,
        )

    def _continuation_query(
        self,
        value: Any,
        path: str,
        expected_query: Mapping[str, Any],
        *,
        upstream: bool,
    ) -> dict[str, str]:
        code = ErrorCode.UPSTREAM_UNAVAILABLE if upstream else ErrorCode.INVALID_REQUEST
        if not isinstance(value, str) or not 1 <= len(value) <= 8192:
            raise MailRuntimeError(code)
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.hostname != "graph.microsoft.com" or parsed.port is not None or parsed.fragment:
            raise MailRuntimeError(code)
        expected = API_PREFIX + path
        if parsed.path != expected:
            raise MailRuntimeError(code)
        try:
            query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True, max_num_fields=12)
        except ValueError as exc:
            raise MailRuntimeError(code) from exc
        if not query or set(query) - _NEXT_PARAMETERS or any(len(values) != 1 for values in query.values()):
            raise MailRuntimeError(code)
        if "$skiptoken" not in query and "$skip" not in query:
            raise MailRuntimeError(code)
        if "$skiptoken" in query:
            skiptoken = query["$skiptoken"][0]
            if not 1 <= len(skiptoken) <= 4096 or any(
                ord(character) < 33 or ord(character) == 127 for character in skiptoken
            ):
                raise MailRuntimeError(code)
        if "$skip" in query:
            skip = query["$skip"][0]
            if not skip.isascii() or not skip.isdigit() or int(skip) > 1_000_000_000:
                raise MailRuntimeError(code)
        if any(any(ord(c) < 32 or ord(c) == 127 for c in item) for values in query.values() for item in values):
            raise MailRuntimeError(code)
        static_keys = set(query) - {"$skip", "$skiptoken"}
        if static_keys != set(expected_query):
            raise MailRuntimeError(code)
        for key, values in query.items():
            if key in {"$skip", "$skiptoken"}:
                continue
            expected_value = expected_query.get(key)
            if expected_value is None or values[0] != str(expected_value):
                raise MailRuntimeError(code)
        continuation = {key: str(value) for key, value in expected_query.items()}
        for key in ("$skip", "$skiptoken"):
            if key in query:
                continuation[key] = query[key][0]
        return continuation

    def _page(self, request: ListRequest | SearchRequest, path: str, query: Mapping[str, Any], *, operation: str, context: str, headers=None) -> Page:
        if type(request.limit) is not int or not 1 <= request.limit <= MAX_PAGE_SIZE:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        context_hash = hashlib.sha256(context.encode()).hexdigest()
        page_query = dict(query)
        if request.cursor is not None:
            cursor = _untoken(request.cursor, "mc1", {"a", "c", "n", "o", "p", "v"}, code=ErrorCode.INVALID_REQUEST)
            if cursor.get("a") != self._account.account_id or cursor.get("c") != context_hash or cursor.get("o") != operation or cursor.get("p") != path:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            page_query = self._continuation_query(cursor.get("n"), path, query, upstream=False)
        value = self._request("GET", path, query=page_query, extra_headers=headers)
        items = value.get("value")
        if not isinstance(items, list) or len(items) > request.limit:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        summaries = tuple(self._summary(item) for item in items)
        next_link = value.get("@odata.nextLink")
        next_cursor = None
        if next_link is not None:
            self._continuation_query(next_link, path, query, upstream=True)
            next_cursor = _token("mc1", {"a": self._account.account_id, "c": context_hash, "n": next_link, "o": operation, "p": path, "v": 1})
        return Page(summaries, next_cursor)

    def list_messages(self, request: ListRequest) -> Page:
        if not isinstance(request.folder, str) or request.folder.casefold() != "inbox":
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        query = {"$select": _MESSAGE_SELECT, "$orderby": "receivedDateTime desc", "$top": request.limit}
        return self._page(request, _LIST_PATH, query, operation="list", context="folder=inbox")

    def _get_message_document(self, message_id: str) -> dict[str, Any]:
        message_id = _safe_id(message_id)
        value = self._request("GET", f"/me/messages/{quote(message_id, safe='')}", query={"$select": _MESSAGE_DETAIL_SELECT}, maximum=MAX_MESSAGE_BYTES)
        if _safe_id(value.get("id"), upstream=True) != message_id:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        conversation = value.get("conversationId")
        if conversation is not None:
            _safe_id(conversation, upstream=True)
        return value

    def _attachment_meta(self, message_id: str, item: Any) -> AttachmentMeta:
        if not isinstance(item, dict):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        kind = item.get("@odata.type")
        if kind != "#microsoft.graph.fileAttachment":
            if kind in {"#microsoft.graph.itemAttachment", "#microsoft.graph.referenceAttachment"}:
                raise MailRuntimeError(ErrorCode.UNSUPPORTED)
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        attachment_id = _safe_id(item.get("id"), upstream=True)
        try:
            name = safe_filename(item.get("name"))
        except MailRuntimeError as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        content_type = item.get("contentType")
        if not isinstance(content_type, str) or not _MIME.fullmatch(content_type):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        size = item.get("size")
        if type(size) is not int or not 0 <= size <= MAX_ATTACHMENT_BYTES:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        context = hashlib.sha256(f"{message_id}\0{attachment_id}\0{name}\0{content_type}\0{size}".encode()).hexdigest()
        locator = _token("ma1", {"a": attachment_id, "c": context, "ct": content_type, "m": message_id, "n": name, "s": size, "v": 1})
        return AttachmentMeta(locator, name, size, content_type)

    def _attachments(self, message_id: str) -> tuple[AttachmentMeta, ...]:
        path = f"/me/messages/{quote(message_id, safe='')}/attachments"
        canonical = {"$select": "id,name,contentType,size,isInline"}
        query: Mapping[str, Any] = canonical
        budget = [MAX_MESSAGE_BYTES]
        results: list[AttachmentMeta] = []
        for _page in range(MAX_ATTACHMENT_PAGES):
            value = self._request(
                "GET",
                path,
                query=query,
                maximum=MAX_MESSAGE_BYTES,
                not_found=ErrorCode.MESSAGE_NOT_FOUND,
                budget=budget,
            )
            items = value.get("value")
            if not isinstance(items, list) or len(results) + len(items) > MAX_ATTACHMENTS:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            results.extend(self._attachment_meta(message_id, item) for item in items)
            next_link = value.get("@odata.nextLink")
            if next_link is None:
                return tuple(results)
            query = self._continuation_query(next_link, path, canonical, upstream=True)
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)

    def get_message(self, message_id: str) -> MessageContent:
        value = self._get_message_document(message_id)
        for key in ("isRead", "hasAttachments"):
            if type(value.get(key)) is not bool:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        headers = value.get("internetMessageHeaders", [])
        if not isinstance(headers, list) or len(headers) > MAX_HEADERS:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        header_total = 0
        for header in headers:
            if not isinstance(header, dict) or not isinstance(header.get("name"), str) or not isinstance(header.get("value"), str):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            header_total += len(header["name"].encode()) + len(header["value"].encode())
            if header_total > MAX_HEADER_BYTES:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        body = value.get("body")
        if (
            not isinstance(body, dict)
            or not isinstance(body.get("contentType"), str)
            or body["contentType"].casefold() not in {"text", "html"}
        ):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        rendered = _text(body.get("content"), 5 * 1024 * 1024)
        recipients = _addresses(value.get("toRecipients")) + _addresses(value.get("ccRecipients")) + _addresses(value.get("bccRecipients"))
        attachments = self._attachments(message_id)
        return MessageContent(
            _safe_id(value["id"], upstream=True),
            _text(value.get("subject", ""), 64 * 1024) or "",
            _sender(value.get("from")),
            recipients,
            _text(value.get("receivedDateTime"), 256, optional=True),
            rendered if body["contentType"].casefold() == "text" else None,
            rendered if body["contentType"].casefold() == "html" else None,
            attachments,
        )

    def _search(self, query: str) -> tuple[str | None, str | None]:
        if not isinstance(query, str) or not query or len(query) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in query):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        terms: list[tuple[str, str]] = []
        index = 0
        while index < len(query):
            while index < len(query) and query[index].isspace():
                index += 1
            if index >= len(query):
                break
            start = index
            while index < len(query) and not query[index].isspace() and query[index] not in ':"':
                index += 1
            atom = query[start:index]
            if index < len(query) and query[index] == ":":
                key = atom.casefold()
                index += 1
            else:
                key = "text"
                index = start
            if index < len(query) and query[index] == '"':
                index += 1
                value_start = index
                while index < len(query) and query[index] != '"':
                    if query[index] == "\\":
                        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                    index += 1
                if index >= len(query):
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                value = query[value_start:index]
                index += 1
                if index < len(query) and not query[index].isspace():
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            else:
                value_start = index
                while index < len(query) and not query[index].isspace():
                    if query[index] in {'"', "\\"}:
                        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                    index += 1
                value = query[value_start:index]
            terms.append((key, value))
            if len(terms) > 32:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if not terms:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        searches: list[str] = []
        filters: list[str] = []
        for key, value in terms:
            if key not in _SAFE_SEARCH_KEYS or not value or len(value) > 1024:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            if key in {"from", "to", "subject", "body", "text"}:
                if '"' in value or "\\" in value:
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                prefix = "" if key == "text" else key + ":"
                searches.append(prefix + '\\"' + value + '\\"')
            elif key in {"after", "before"}:
                try:
                    datetime.strptime(value, "%Y-%m-%d")
                except ValueError as exc:
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
                operator = "ge" if key == "after" else "lt"
                filters.append(f"receivedDateTime {operator} {value}T00:00:00Z")
            elif key == "is" and value.casefold() in {"read", "unread"}:
                filters.append("isRead eq " + ("true" if value.casefold() == "read" else "false"))
            elif key == "has" and value.casefold() == "attachment":
                filters.append("hasAttachments eq true")
            else:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        search = '"' + " AND ".join(searches) + '"' if searches else None
        filter_value = " and ".join(filters) or None
        return search, filter_value

    def search_messages(self, request: SearchRequest) -> Page:
        search, filter_value = self._search(request.query)
        query: dict[str, Any] = {"$select": _MESSAGE_SELECT, "$top": request.limit}
        if search:
            query["$search"] = search
        if filter_value:
            query["$filter"] = filter_value
        context = json.dumps({"filter": filter_value, "search": search}, sort_keys=True, separators=(",", ":"))
        return self._page(request, "/me/messages", query, operation="search", context=context, headers={"ConsistencyLevel": "eventual"})

    def download_attachment(self, request: AttachmentRequest, sink: AttachmentSink) -> AttachmentDownloadResult:
        message_id = _safe_id(request.message_id)
        try:
            locator = _untoken(request.attachment_id, "ma1", {"a", "c", "ct", "m", "n", "s", "v"}, code=ErrorCode.ATTACHMENT_NOT_FOUND)
        except MailRuntimeError as exc:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND) from exc
        if locator.get("m") != message_id:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        attachment_id = locator.get("a")
        name, content_type, size = locator.get("n"), locator.get("ct"), locator.get("s")
        try:
            _safe_id(attachment_id)
            name = safe_filename(name)
        except MailRuntimeError as exc:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND) from exc
        if not isinstance(content_type, str) or not _MIME.fullmatch(content_type) or type(size) is not int or not 0 <= size <= MAX_ATTACHMENT_BYTES:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        expected_context = hashlib.sha256(f"{message_id}\0{attachment_id}\0{name}\0{content_type}\0{size}".encode()).hexdigest()
        if locator.get("c") != expected_context:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        value = self._request("GET", f"/me/messages/{quote(message_id, safe='')}/attachments/{quote(attachment_id, safe='')}", maximum=MAX_ATTACHMENT_RESPONSE_BYTES, not_found=ErrorCode.ATTACHMENT_NOT_FOUND)
        if value.get("@odata.type") in {"#microsoft.graph.itemAttachment", "#microsoft.graph.referenceAttachment"}:
            raise MailRuntimeError(ErrorCode.UNSUPPORTED)
        if value.get("@odata.type") != "#microsoft.graph.fileAttachment" or value.get("id") != attachment_id or value.get("name") != name or value.get("contentType") != content_type or value.get("size") != size:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        return sink.write(name, _chunks(value.get("contentBytes"), expected=size), content_type=content_type)

    def _recipients(self, values: tuple[str, ...]) -> list[dict[str, dict[str, str]]]:
        return [{"emailAddress": {"address": _strict_address(value)[1]}} for value in values]

    def _body(self, draft: Draft) -> dict[str, str]:
        if draft.html is not None:
            return {"contentType": "HTML", "content": draft.html}
        if draft.text is not None:
            return {"contentType": "Text", "content": draft.text}
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)

    def _draft_payload(
        self,
        draft: Draft,
        *,
        require_recipients: bool,
        include_empty_recipients: bool = False,
    ) -> tuple[dict[str, Any], tuple[str, ...]]:
        recipients = draft.to + draft.cc + draft.bcc
        if (require_recipients and not recipients) or len(recipients) > MAX_RECIPIENTS:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        payload: dict[str, Any] = {"body": self._body(draft)}
        if draft.subject:
            payload["subject"] = draft.subject
        for name, values in (("toRecipients", draft.to), ("ccRecipients", draft.cc), ("bccRecipients", draft.bcc)):
            if values or include_empty_recipients:
                payload[name] = self._recipients(values)
        return payload, tuple(_strict_address(value)[1] for value in recipients)

    def _document_recipients(self, value: Mapping[str, Any]) -> tuple[str, ...]:
        recipients = (
            _addresses(value.get("toRecipients"))
            + _addresses(value.get("ccRecipients"))
            + _addresses(value.get("bccRecipients"))
        )
        if not recipients or len(recipients) > MAX_RECIPIENTS:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return recipients

    def _cleanup_draft(self, draft_id: str) -> bool:
        try:
            self._request(
                "DELETE",
                f"/me/messages/{quote(draft_id, safe='')}",
                expect_json=False,
            )
            return True
        except _GraphRequestFailure as exc:
            return exc.status == 404
        except MailRuntimeError:
            return False

    def _raise_staged_send_failure(self, draft_id: str, error: MailRuntimeError) -> None:
        if isinstance(error, _GraphRequestFailure) and 400 <= error.status < 500:
            cleaned = self._cleanup_draft(draft_id)
            raise MailRuntimeError(
                error.code, retryable=False, ambiguous=not cleaned
            ) from error
        if error.ambiguous:
            raise error
        raise MailRuntimeError(
            ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True
        ) from error

    def _raise_unsent_reply_failure(self, draft_id: str, error: MailRuntimeError) -> None:
        cleaned = self._cleanup_draft(draft_id)
        raise MailRuntimeError(
            error.code, retryable=False, ambiguous=not cleaned
        ) from error

    def _mutation_id(self, value: Any) -> str:
        try:
            return _safe_id(value, upstream=True)
        except MailRuntimeError as exc:
            raise MailRuntimeError(
                ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True
            ) from exc

    def send_message(self, draft: Draft) -> SendResult:
        payload, recipients = self._draft_payload(draft, require_recipients=True)
        created = self._request("POST", "/me/messages", payload=payload)
        draft_id = self._mutation_id(created.get("id"))
        try:
            self._request("POST", f"/me/messages/{quote(draft_id, safe='')}/send", payload={}, expect_json=False)
        except MailRuntimeError as exc:
            self._raise_staged_send_failure(draft_id, exc)
        return SendResult(draft_id, recipients, (), False)

    def reply_message(self, message_id: str, draft: Draft) -> ReplyResult:
        message_id = _safe_id(message_id)
        original = self._get_message_document(message_id)
        conversation = _safe_id(original.get("conversationId"), upstream=True)
        created = self._request("POST", f"/me/messages/{quote(message_id, safe='')}/createReply", payload={})
        reply_id = self._mutation_id(created.get("id"))
        try:
            if _safe_id(created.get("conversationId"), upstream=True) != conversation:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            created_recipients = self._document_recipients(created)
            has_supplied_recipients = bool(draft.to or draft.cc or draft.bcc)
            payload, supplied = self._draft_payload(
                draft,
                require_recipients=False,
                include_empty_recipients=has_supplied_recipients,
            )
            patched = self._request("PATCH", f"/me/messages/{quote(reply_id, safe='')}", payload=payload)
            if _safe_id(patched.get("id"), upstream=True) != reply_id or _safe_id(patched.get("conversationId"), upstream=True) != conversation:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            if not all(key in patched for key in ("toRecipients", "ccRecipients", "bccRecipients")):
                patched = self._request(
                    "GET",
                    f"/me/messages/{quote(reply_id, safe='')}",
                    query={"$select": "id,conversationId,toRecipients,ccRecipients,bccRecipients"},
                )
                if _safe_id(patched.get("id"), upstream=True) != reply_id or _safe_id(patched.get("conversationId"), upstream=True) != conversation:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            final_recipients = self._document_recipients(patched)
            expected_recipients = supplied if has_supplied_recipients else created_recipients
            if final_recipients != expected_recipients:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        except MailRuntimeError as exc:
            self._raise_unsent_reply_failure(reply_id, exc)
        try:
            self._request("POST", f"/me/messages/{quote(reply_id, safe='')}/send", payload={}, expect_json=False)
        except MailRuntimeError as exc:
            self._raise_staged_send_failure(reply_id, exc)
        return ReplyResult(reply_id, final_recipients, (), False)

    def delete_message(self, message_id: str) -> DeleteResult:
        message_id = _safe_id(message_id)
        value = self._request("POST", f"/me/messages/{quote(message_id, safe='')}/move", payload={"destinationId": "deleteditems"})
        try:
            moved_id = _safe_id(value.get("id"), upstream=True)
            if moved_id != message_id:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            _safe_id(value.get("parentFolderId"), upstream=True)
        except MailRuntimeError as exc:
            raise MailRuntimeError(
                ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True
            ) from exc
        return DeleteResult(moved_id, "trash")
    def probe_connection(self) -> None:
        self._request("GET", "/me/mailFolders/inbox", query={"$select": "displayName"}, maximum=64 * 1024)
