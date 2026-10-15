from __future__ import annotations

import base64
import hashlib
import json
import re
import shlex
import socket
import ssl
import time
from collections.abc import Callable, Iterable, Mapping
from datetime import date, datetime, timezone
from email import policy
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from .imap_smtp import _strict_address
from .io_security import AttachmentSink
from .mime import safe_filename
from .models import (
    AccountConfig, AttachmentDownloadResult, AttachmentMeta, AttachmentRequest, DeleteResult,
    Draft, ErrorCode, ListRequest, MailRuntimeError, MessageContent, MessageSummary, Page,
    ReplyResult, SearchRequest, SendResult,
)


SESSION_URL = "https://api.fastmail.com/jmap/session"
CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
SUBMISSION = "urn:ietf:params:jmap:submission"
API_HOSTS = {"api.fastmail.com", "jmap.fastmail.com"}
DOWNLOAD_HOSTS = {"www.fastmailusercontent.com"}
DEFAULT_TIMEOUT = 20.0
SESSION_TTL = 60.0
MAX_JSON = 8 * 1024 * 1024
MAX_DOWNLOAD = 25 * 1024 * 1024
MAX_UPLOAD = 25 * 1024 * 1024
MAX_REQUEST = 8 * 1024 * 1024
MAX_PAGE = 100
MAX_OBJECTS = 100
MAX_CALLS = 16
_ID = re.compile(r"[A-Za-z0-9._~-]{1,255}\Z")
_TOKEN = re.compile(r"fj[ac]1\.[A-Za-z0-9_-]{2,16384}\Z")
_MIME_TYPE = re.compile(r"[A-Za-z0-9!#$&^_.+-]{1,127}/[A-Za-z0-9!#$&^_.+-]{1,127}\Z", re.ASCII)


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


class UrllibFastmailHttpClient:
    def __init__(self, ssl_context_factory: Callable[[], ssl.SSLContext] = ssl.create_default_context) -> None:
        self._opener = build_opener(_NoRedirect(), HTTPSHandler(context=ssl_context_factory()))

    def request(self, method, url, *, headers, body, timeout):
        request = Request(url, data=body, headers=dict(headers), method=method)
        try:
            return self._opener.open(request, timeout=timeout)
        except HTTPError as response:
            return response


def _safe_id(value: Any, *, upstream: bool = False) -> str:
    code = ErrorCode.UPSTREAM_UNAVAILABLE if upstream else ErrorCode.INVALID_REQUEST
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise MailRuntimeError(code)
    return value


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _unb64(value: str, *, maximum: int) -> bytes:
    if len(value) > maximum * 2:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    try:
        result = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except ValueError as exc:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
    if len(result) > maximum:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return result


def _token(prefix: str, payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return prefix + "." + _b64(raw)


def _untoken(value: Any, prefix: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, str) or not _TOKEN.fullmatch(value) or not value.startswith(prefix + "."):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    try:
        payload = json.loads(_unb64(value.split(".", 1)[1], maximum=12 * 1024).decode())
    except (UnicodeError, json.JSONDecodeError, MailRuntimeError) as exc:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
    if not isinstance(payload, dict) or set(payload) != keys or payload.get("v") != 1 or _token(prefix, payload) != value:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return payload


def _validate_url(value: Any, hosts: set[str], *, template: bool = False) -> str:
    if not isinstance(value, str) or len(value) > 4096 or "\\" in value:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    probe = value
    if template:
        for marker in ("{accountId}", "{blobId}", "{name}", "{type}"):
            probe = probe.replace(marker, "x")
    parsed = urlsplit(probe)
    try:
        port = parsed.port
    except ValueError as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password or port not in (None, 443):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    decoded_path = unquote(parsed.path)
    if any(segment in {".", ".."} for segment in decoded_path.split("/")) or parsed.fragment:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return value


def _bounded(response: _Response, maximum: int) -> bytes:
    raw_length = response.headers.get("Content-Length")
    if raw_length is not None:
        try:
            if int(raw_length) < 0 or int(raw_length) > maximum:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        except ValueError as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    chunks, total = [], 0
    while True:
        chunk = response.read(min(64 * 1024, maximum + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > maximum:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        chunks.append(chunk)
    return b"".join(chunks)


def _json_response(response: _Response, maximum: int = MAX_JSON) -> dict[str, Any]:
    raw = _bounded(response, maximum)
    try:
        value = json.loads(raw.decode())
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    if not isinstance(value, dict):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return value


def _text(value: Any, maximum: int = 256 * 1024, optional: bool = False) -> str | None:
    if value is None and optional:
        return None
    if not isinstance(value, str) or len(value.encode()) > maximum or "\x00" in value:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return value


def _state(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 1024 or any(ord(c) < 33 or ord(c) == 127 for c in value):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return value


def _account_response(value: Mapping[str, Any], account_id: str) -> None:
    if value.get("accountId") != account_id:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)


def _message_identifier(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 996 or any(ord(c) < 33 or ord(c) == 127 for c in value):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    core = value[1:-1] if value.startswith("<") and value.endswith(">") else value
    if not re.fullmatch(r"[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+@[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+", core):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return "<" + core + ">"


def _bounded_object(value: Any, *, depth: int = 0, budget: list[int] | None = None) -> dict[str, Any]:
    if not isinstance(value, dict) or depth > 8 or len(value) > 256:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
    if budget is None:
        budget = [0]
    result: dict[str, Any] = {}
    for key, item in value.items():
        if (not isinstance(key, str) or not key or len(key) > 1024
                or "\x00" in key):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        budget[0] += len(key.encode())
        if budget[0] > 64 * 1024:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        if isinstance(item, dict):
            result[key] = _bounded_object(item, depth=depth + 1, budget=budget)
        elif item is None or type(item) in {bool, int, float}:
            result[key] = item
        elif isinstance(item, str) and len(item.encode()) <= 64 * 1024 and "\x00" not in item:
            budget[0] += len(item.encode())
            result[key] = item
        elif isinstance(item, list) and depth < 8 and len(item) <= 256:
            normalized = []
            for member in item:
                if isinstance(member, dict):
                    normalized.append(_bounded_object(member, depth=depth + 1, budget=budget))
                elif member is None or type(member) in {bool, int, float}:
                    normalized.append(member)
                elif isinstance(member, str) and len(member.encode()) <= 64 * 1024 and "\x00" not in member:
                    budget[0] += len(member.encode())
                    normalized.append(member)
                else:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
            result[key] = normalized
        else:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
    return result


def _set_response_unchecked(value: Mapping[str, Any], account_id: str) -> dict[str, Any]:
    _account_response(value, account_id)
    old_state = value.get("oldState")
    if old_state is not None:
        _state(old_state)
    new_state = _state(value.get("newState"))

    maps: dict[str, dict[str, Any]] = {}
    for name in ("created", "updated", "notCreated", "notUpdated", "notDestroyed"):
        raw = value.get(name)
        if raw is None:
            maps[name] = {}
            continue
        if not isinstance(raw, dict) or len(raw) > MAX_OBJECTS:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        normalized: dict[str, Any] = {}
        for key, item in raw.items():
            safe_key = _safe_id(key, upstream=True)
            if name == "updated" and item is None:
                normalized[safe_key] = None
            else:
                normalized[safe_key] = _bounded_object(item)
        maps[name] = normalized

    raw_destroyed = value.get("destroyed")
    if raw_destroyed is None:
        destroyed: list[str] = []
    elif isinstance(raw_destroyed, list) and len(raw_destroyed) <= MAX_OBJECTS:
        destroyed = [_safe_id(item, upstream=True) for item in raw_destroyed]
        if len(destroyed) != len(set(destroyed)):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
    else:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
    return {"oldState": old_state, "newState": new_state, "destroyed": destroyed, **maps}


def _set_response(value: Mapping[str, Any], account_id: str) -> dict[str, Any]:
    try:
        return _set_response_unchecked(value, account_id)
    except MailRuntimeError as exc:
        if exc.code == ErrorCode.UPSTREAM_UNAVAILABLE and exc.ambiguous and not exc.retryable:
            raise
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True) from exc


def _address(value: Any) -> str:
    if not isinstance(value, dict):
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    email = value.get("email")
    try:
        address = _strict_address(email)[1]
    except MailRuntimeError as exc:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
    name = value.get("name")
    if name is None or name == "":
        return address
    name = _text(name, 1024)
    return f"{name} <{address}>"


def _addresses(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or len(value) > 100:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return tuple(_address(item) for item in value)


class FastmailJmapAdapter:
    def __init__(self, account: AccountConfig, *, http_client: _HttpClient | None = None,
                 timeout: float = DEFAULT_TIMEOUT, monotonic: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        if str(account.auth.get("type", "")).upper() != "API_TOKEN":
            raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)
        token = account.auth.get("secret")
        if not isinstance(token, str) or not token or len(token) > 16 * 1024 or any(ord(c) < 33 or ord(c) == 127 for c in token):
            raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)
        if not isinstance(timeout, (int, float)) or not 0 < timeout <= DEFAULT_TIMEOUT:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        self._account, self._token = account, token
        self._http = http_client or UrllibFastmailHttpClient()
        self._timeout, self._monotonic, self._sleep, self._clock = float(timeout), monotonic, sleep, clock
        self._session_cache: tuple[float, dict[str, Any]] | None = None
        self._mailboxes: dict[str, str] | None = None

    def _request(self, method: str, url: str, *, body: bytes | None = None,
                 not_found: ErrorCode | None = None, idempotent: bool = False,
                 mutation: bool = False) -> _Response:
        headers = {"Authorization": "Bearer " + self._token, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        attempts = 2 if idempotent else 1
        response = None
        for attempt in range(attempts):
            try:
                response = self._http.request(method, url, headers=headers, body=body, timeout=self._timeout)
            except (OSError, socket.timeout, TimeoutError, URLError) as exc:
                if attempt + 1 < attempts:
                    self._sleep(0.25)
                    continue
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation,
                                       ambiguous=mutation) from exc
            if response.status in {429, 500, 502, 503, 504} and attempt + 1 < attempts:
                response.close()
                self._sleep(0.25)
                continue
            break
        if response is None:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if response.status == 401:
            self._session_cache = None
            response.close()
            raise MailRuntimeError(ErrorCode.AUTH_EXPIRED)
        if response.status == 403:
            response.close(); raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
        if response.status == 429:
            response.close(); raise MailRuntimeError(ErrorCode.RATE_LIMITED)
        if response.status == 404 and not_found is not None:
            response.close(); raise MailRuntimeError(not_found)
        if response.status < 200 or response.status >= 300:
            status = response.status
            response.close()
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation,
                                   ambiguous=mutation and status >= 500)
        return response

    def _session(self) -> dict[str, Any]:
        now = self._monotonic()
        if self._session_cache and self._session_cache[0] > now:
            return self._session_cache[1]
        response = self._request("GET", SESSION_URL, idempotent=True)
        try:
            session = _json_response(response, 512 * 1024)
        finally:
            response.close()
        capabilities = session.get("capabilities")
        accounts = session.get("accounts")
        primary = session.get("primaryAccounts")
        if not isinstance(capabilities, dict) or not all(key in capabilities for key in (CORE, MAIL, SUBMISSION)):
            raise MailRuntimeError(ErrorCode.UNSUPPORTED)
        if not isinstance(accounts, dict) or not isinstance(primary, dict):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        account_id = _safe_id(primary.get(MAIL), upstream=True)
        if primary.get(SUBMISSION) != account_id or account_id not in accounts:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        account_caps = accounts[account_id].get("accountCapabilities") if isinstance(accounts[account_id], dict) else None
        if not isinstance(account_caps, dict) or MAIL not in account_caps or SUBMISSION not in account_caps:
            raise MailRuntimeError(ErrorCode.UNSUPPORTED)
        core = capabilities[CORE]
        if not isinstance(core, dict):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        for name, local in (("maxSizeUpload", MAX_UPLOAD), ("maxSizeRequest", MAX_REQUEST),
                            ("maxCallsInRequest", MAX_CALLS), ("maxObjectsInGet", MAX_OBJECTS),
                            ("maxObjectsInSet", MAX_OBJECTS)):
            value = core.get(name)
            if type(value) is not int or not 0 < value <= (1 << 63) - 1:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            core[name] = min(value, local)
        upload_url, download_url = session.get("uploadUrl"), session.get("downloadUrl")
        if not isinstance(upload_url, str) or upload_url.count("{accountId}") != 1:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if not isinstance(download_url, str) or any(download_url.count(marker) != 1 for marker in ("{accountId}", "{blobId}", "{name}", "{type}")):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        session["apiUrl"] = _validate_url(session.get("apiUrl"), API_HOSTS)
        session["uploadUrl"] = _validate_url(upload_url, API_HOSTS, template=True)
        session["downloadUrl"] = _validate_url(download_url, DOWNLOAD_HOSTS, template=True)
        session["_accountId"] = account_id
        self._session_cache = (now + SESSION_TTL, session)
        return session

    def _map_jmap_error(self, kind: Any, *, mutation: bool = False,
                        missing: ErrorCode = ErrorCode.MESSAGE_NOT_FOUND) -> MailRuntimeError:
        if kind == "notFound": return MailRuntimeError(missing)
        if kind in {"forbidden", "accountNotFound"}: return MailRuntimeError(ErrorCode.PERMISSION_DENIED)
        if kind in {"rateLimit", "tooManyRequests"}: return MailRuntimeError(ErrorCode.RATE_LIMITED)
        if kind in {"unknownMethod", "invalidArguments", "unsupportedFilter", "unsupportedSort"}: return MailRuntimeError(ErrorCode.UNSUPPORTED)
        if kind == "serverPartialFail": return MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        if kind == "serverFail": return MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation)
        return MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation)

    def _post_responses(self, calls: list[tuple[str, dict[str, Any], str]], *, mutation: bool) -> list[Any]:
        session = self._session()
        if len(calls) > session["capabilities"][CORE]["maxCallsInRequest"]:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        payload = {"using": [CORE, MAIL, SUBMISSION], "methodCalls": [[name, args, call_id] for name, args, call_id in calls]}
        raw = json.dumps(payload, separators=(",", ":")).encode()
        if len(raw) > session["capabilities"][CORE]["maxSizeRequest"]:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        response = self._request("POST", session["apiUrl"], body=raw, mutation=mutation)
        try:
            try:
                document = _json_response(response)
            except MailRuntimeError as exc:
                if mutation:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True) from exc
                raise
        finally:
            response.close()
        try:
            _state(document.get("sessionState"))
        except MailRuntimeError as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation,
                                   ambiguous=mutation) from exc
        values = document.get("methodResponses")
        if not isinstance(values, list):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation, ambiguous=mutation)
        return values

    def _jmap(self, calls: list[tuple[str, dict[str, Any], str]], *, mutation: bool = False) -> list[dict[str, Any]]:
        values = self._post_responses(calls, mutation=mutation)
        if len(values) != len(calls):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation, ambiguous=mutation)
        result = []
        for expected, value in zip(calls, values):
            if not isinstance(value, list) or len(value) != 3 or value[2] != expected[2]:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation, ambiguous=mutation)
            if value[0] == "error":
                detail = value[1]
                raise self._map_jmap_error(detail.get("type") if isinstance(detail, dict) else None,
                                           mutation=mutation)
            if value[0] != expected[0] or not isinstance(value[1], dict):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=not mutation, ambiguous=mutation)
            result.append(value[1])
        return result

    def _submission_set(self, arguments: dict[str, Any], email_id: str) -> dict[str, Any]:
        call = ("EmailSubmission/set", arguments, "m1")
        values = self._post_responses([call], mutation=True)
        if not values:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        primary = values[0]
        if not isinstance(primary, list) or len(primary) != 3 or primary[2] != "m1":
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        if primary[0] == "error":
            if len(values) != 1:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
            detail = primary[1]
            raise self._map_jmap_error(detail.get("type") if isinstance(detail, dict) else None,
                                       mutation=True)
        if len(values) != 2:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        if primary[0] != "EmailSubmission/set" or not isinstance(primary[1], dict):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        primary_payload = primary[1]
        account_id = self._session()["_accountId"]
        normalized = _set_response(primary_payload, account_id)
        created, not_created = normalized["created"], normalized["notCreated"]
        if set(created) | set(not_created) != {"submit"} or set(created) & set(not_created):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        implicit = values[1]
        if (not isinstance(implicit, list) or len(implicit) != 3 or implicit[0] != "Email/set"
                or implicit[2] != "m1" or not isinstance(implicit[1], dict)):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        implicit_set = _set_response(implicit[1], account_id)
        if created:
            if set(implicit_set["updated"]) != {email_id} or implicit_set["notUpdated"]:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        elif implicit_set["updated"] or implicit_set["notUpdated"]:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        return normalized

    def _mailbox_roles(self) -> dict[str, str]:
        if self._mailboxes is not None:
            return self._mailboxes
        account_id = self._session()["_accountId"]
        value = self._jmap([("Mailbox/get", {"accountId": account_id, "properties": ["id", "name", "role"]}, "m1")])[0]
        rows = value.get("list")
        _account_response(value, account_id); _state(value.get("state"))
        if not isinstance(rows, list) or len(rows) > MAX_OBJECTS:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        roles: dict[str, str] = {}
        seen: set[str] = set()
        for row in rows:
            if not isinstance(row, dict): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            role, mailbox_id = row.get("role"), row.get("id")
            mailbox_id = _safe_id(mailbox_id, upstream=True)
            if mailbox_id in seen: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            seen.add(mailbox_id)
            if role in {"inbox", "trash", "drafts", "sent"}:
                if role in roles: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                roles[role] = mailbox_id
        if not {"inbox", "trash", "drafts", "sent"}.issubset(roles):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        self._mailboxes = roles
        return roles

    def _cursor(self, operation: str, binding: str, state: str, position: int) -> str:
        payload = {"a": self._account.account_id, "b": binding, "o": operation, "p": position, "q": state, "v": 1}
        payload["c"] = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return _token("fjc1", payload)

    def _position(self, cursor: str | None, operation: str, binding: str) -> tuple[int, str | None]:
        if cursor is None: return 0, None
        value = _untoken(cursor, "fjc1", {"a", "b", "c", "o", "p", "q", "v"})
        check = {k: value[k] for k in ("a", "b", "o", "p", "q", "v")}
        if value["c"] != hashlib.sha256(json.dumps(check, sort_keys=True, separators=(",", ":")).encode()).hexdigest():
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if value["a"] != self._account.account_id or value["o"] != operation or value["b"] != binding or type(value["p"]) is not int or value["p"] < 0:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if not isinstance(value["q"], str) or not value["q"]:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return value["p"], value["q"]

    def _email_get(self, ids: list[str], call_id: str = "m1") -> list[dict[str, Any]]:
        if not ids: return []
        if len(ids) != len(set(ids)): raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        account_id = self._session()["_accountId"]
        properties = ["id", "blobId", "threadId", "mailboxIds", "subject", "preview", "receivedAt", "from", "to", "cc", "bcc", "replyTo", "messageId", "inReplyTo", "references", "textBody", "htmlBody", "bodyValues", "attachments"]
        batch_size = self._session()["capabilities"][CORE]["maxObjectsInGet"]
        result: dict[str, dict[str, Any]] = {}
        for offset in range(0, len(ids), batch_size):
            batch = ids[offset:offset + batch_size]
            value = self._jmap([("Email/get", {"accountId": account_id, "ids": batch, "properties": properties, "fetchTextBodyValues": True, "fetchHTMLBodyValues": True, "maxBodyValueBytes": 5 * 1024 * 1024}, call_id)])[0]
            _account_response(value, account_id); _state(value.get("state"))
            rows, missing = value.get("list"), value.get("notFound", [])
            if not isinstance(rows, list) or not isinstance(missing, list):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            found_ids: list[str] = []
            for row in rows:
                if not isinstance(row, dict): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                row_id = _safe_id(row.get("id"), upstream=True)
                if row_id in result or row_id in found_ids: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                found_ids.append(row_id); result[row_id] = row
            missing_ids = [_safe_id(item, upstream=True) for item in missing]
            if len(missing_ids) != len(set(missing_ids)) or set(found_ids) & set(missing_ids) or set(found_ids + missing_ids) != set(batch):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return [result[item] for item in ids if item in result]

    def _summary(self, row: Mapping[str, Any]) -> MessageSummary:
        senders = _addresses(row.get("from"))
        attachments = row.get("attachments", [])
        if not isinstance(attachments, list): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return MessageSummary(_safe_id(row.get("id"), upstream=True), _text(row.get("subject", "")) or "", senders[0] if senders else None, _text(row.get("receivedAt"), 256, True), _text(row.get("preview"), 256 * 1024, True), bool(attachments))

    def _attachment(self, email_id: str, row: Mapping[str, Any]) -> AttachmentMeta:
        blob = _safe_id(row.get("blobId"), upstream=True)
        raw_name = _text(row.get("name"), 240)
        try:
            name = safe_filename(raw_name or "")
        except MailRuntimeError as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        mime = _text(row.get("type"), 255)
        if not isinstance(mime, str) or not _MIME_TYPE.fullmatch(mime):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        size = row.get("size")
        if not isinstance(size, int) or isinstance(size, bool) or not 0 <= size <= MAX_DOWNLOAD:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        base = {"a": self._session()["_accountId"], "b": blob, "e": email_id, "n": name, "s": size, "t": mime, "v": 1}
        base["c"] = hashlib.sha256(json.dumps(base, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return AttachmentMeta(_token("fja1", base), name, size, mime)

    def _content(self, row: Mapping[str, Any]) -> MessageContent:
        email_id = _safe_id(row.get("id"), upstream=True)
        values = row.get("bodyValues", {})
        if not isinstance(values, dict) or len(values) > 500: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        def body(kind: str) -> str | None:
            parts = row.get(kind, [])
            if not isinstance(parts, list) or len(parts) > 500: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            output = []
            for part in parts:
                if not isinstance(part, dict) or not isinstance(part.get("partId"), str): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                value = values.get(part["partId"])
                if not isinstance(value, dict) or value.get("isTruncated") or value.get("isEncodingProblem"): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                output.append(_text(value.get("value"), 5 * 1024 * 1024) or "")
            return "\n".join(output) if output else None
        raw_attachments = row.get("attachments", [])
        if not isinstance(raw_attachments, list) or len(raw_attachments) > 500: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if not all(isinstance(item, dict) for item in raw_attachments):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        attachments = tuple(self._attachment(email_id, item) for item in raw_attachments)
        senders = _addresses(row.get("from"))
        recipients = _addresses(row.get("to")) + _addresses(row.get("cc"))
        return MessageContent(email_id, _text(row.get("subject", "")) or "", senders[0] if senders else None, recipients, _text(row.get("receivedAt"), 256, True), body("textBody"), body("htmlBody"), attachments)

    def _page(self, operation: str, binding: str, filter_value: dict[str, Any], limit: int, cursor: str | None) -> Page:
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_PAGE: raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        position, expected_state = self._position(cursor, operation, binding)
        account_id = self._session()["_accountId"]
        query = {"accountId": account_id, "filter": filter_value, "sort": [{"property": "receivedAt", "isAscending": False}], "position": position, "limit": limit}
        result = self._jmap([("Email/query", query, "m2" if operation == "list" else "m1")])[0]
        ids, total, state = result.get("ids"), result.get("total"), result.get("queryState")
        _account_response(result, account_id); state = _state(state)
        if (not isinstance(ids, list) or len(ids) > limit or type(total) is not int or total < 0
                or type(result.get("position")) is not int or result.get("position") != position):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        validated_ids = [_safe_id(item, upstream=True) for item in ids]
        if len(validated_ids) != len(set(validated_ids)) or total < position + len(validated_ids):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if expected_state is not None and state != expected_state:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        rows = self._email_get(validated_ids, "m3")
        next_position = position + len(ids)
        next_cursor = self._cursor(operation, binding, state, next_position) if ids and next_position < total else None
        return Page(tuple(self._summary(row) for row in rows), next_cursor)

    def list_messages(self, request: ListRequest) -> Page:
        if request.folder not in {"inbox", "trash", "drafts"}: raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        mailbox = self._mailbox_roles()[request.folder]
        return self._page("list", request.folder, {"inMailbox": mailbox}, request.limit, request.cursor)

    def get_message(self, message_id: str) -> MessageContent:
        message_id = _safe_id(message_id)
        rows = self._email_get([message_id])
        if len(rows) != 1: raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        return self._content(rows[0])

    def _search_filter(self, query: str) -> dict[str, Any]:
        if not isinstance(query, str) or not query.strip() or len(query) > 4096: raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        try: tokens = shlex.split(query)
        except ValueError as exc: raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
        result: dict[str, Any] = {}
        text = []
        for token in tokens:
            if ":" not in token: text.append(token); continue
            key, value = token.split(":", 1)
            if not value: raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            if key in {"from", "to", "subject", "text"}:
                if key in result: raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                result[key] = value
            elif key in {"after", "before"}:
                if key in result or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                try: date.fromisoformat(value)
                except ValueError as exc: raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
                result[key] = value + "T00:00:00Z"
            elif key == "has" and value == "attachment": result["hasAttachment"] = True
            elif key == "in": result["inMailbox"] = self._mailbox_roles().get(value, _safe_id(value))
            elif key in {"is", "not"}:
                mapping = {
                    ("is", "read"): ("hasKeyword", "$seen"),
                    ("is", "unread"): ("notKeyword", "$seen"),
                    ("is", "flagged"): ("hasKeyword", "$flagged"),
                    ("is", "unflagged"): ("notKeyword", "$flagged"),
                    ("not", "read"): ("notKeyword", "$seen"),
                    ("not", "unread"): ("hasKeyword", "$seen"),
                    ("not", "flagged"): ("notKeyword", "$flagged"),
                    ("not", "unflagged"): ("hasKeyword", "$flagged"),
                }
                mapped = mapping.get((key, value))
                if mapped is None or mapped[0] in result or "hasKeyword" in result or "notKeyword" in result:
                    raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
                result[mapped[0]] = mapped[1]
            else: raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if text: result["text"] = " ".join(text)
        return result

    def search_messages(self, request: SearchRequest) -> Page:
        filter_value = self._search_filter(request.query)
        binding = hashlib.sha256(json.dumps(filter_value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return self._page("search", binding, filter_value, request.limit, request.cursor)

    def download_attachment(self, request: AttachmentRequest, sink: AttachmentSink) -> AttachmentDownloadResult:
        locator = _untoken(request.attachment_id, "fja1", {"a", "b", "c", "e", "n", "s", "t", "v"})
        try:
            locator["a"] = _safe_id(locator.get("a"))
            locator["b"] = _safe_id(locator.get("b"))
            locator["e"] = _safe_id(locator.get("e"))
            locator["n"] = safe_filename(locator.get("n"))
        except (TypeError, MailRuntimeError) as exc:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
        if (not isinstance(locator.get("t"), str) or not _MIME_TYPE.fullmatch(locator["t"])
                or type(locator.get("s")) is not int or not 0 <= locator["s"] <= MAX_DOWNLOAD
                or not isinstance(locator.get("c"), str) or not re.fullmatch(r"[0-9a-f]{64}", locator["c"])):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        check = {k: locator[k] for k in ("a", "b", "e", "n", "s", "t", "v")}
        if locator["c"] != hashlib.sha256(json.dumps(check, sort_keys=True, separators=(",", ":")).encode()).hexdigest() or locator["e"] != request.message_id or locator["a"] != self._session()["_accountId"]:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        rows = self._email_get([locator["e"]])
        if len(rows) != 1:
            raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        attachments = rows[0].get("attachments")
        if not isinstance(attachments, list):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if not all(isinstance(item, dict) for item in attachments):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        for item in attachments:
            self._attachment(locator["e"], item)
        matches = [item for item in attachments
                   if item.get("blobId") == locator["b"] and item.get("name") == locator["n"]
                   and item.get("type") == locator["t"] and item.get("size") == locator["s"]]
        if len(matches) != 1:
            raise MailRuntimeError(ErrorCode.ATTACHMENT_NOT_FOUND)
        session = self._session()
        replacements = {"{accountId}": quote(locator["a"], safe=""), "{blobId}": quote(locator["b"], safe=""), "{name}": quote(locator["n"], safe=""), "{type}": quote(locator["t"], safe="")}
        url = session["downloadUrl"]
        for marker, value in replacements.items(): url = url.replace(marker, value)
        _validate_url(url, DOWNLOAD_HOSTS)
        response = self._request("GET", url, not_found=ErrorCode.ATTACHMENT_NOT_FOUND, idempotent=True)
        try:
            expected = locator["s"]
            response_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().casefold()
            if response_type != locator["t"].casefold():
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            declared = response.headers.get("Content-Length")
            if declared is not None:
                try:
                    if int(declared) != expected or int(declared) > MAX_DOWNLOAD:
                        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                except ValueError as exc:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
            def chunks() -> Iterable[bytes]:
                total = 0
                while True:
                    chunk = response.read(min(64 * 1024, MAX_DOWNLOAD + 1 - total))
                    if not chunk: break
                    total += len(chunk)
                    if total > MAX_DOWNLOAD: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
                    yield chunk
                if total != expected: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            return sink.write(locator["n"], chunks(), content_type=locator["t"])
        finally:
            response.close()

    def _outbound(self, draft: Draft, reply: Mapping[str, Any] | None = None) -> tuple[bytes, tuple[str, ...]]:
        recipients = draft.to + draft.cc + draft.bcc
        if not recipients or len(recipients) > 100: raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        parsed, envelope = {}, []
        for name, values in (("to", draft.to), ("cc", draft.cc), ("bcc", draft.bcc)):
            entries = tuple(_strict_address(item) for item in values)
            parsed[name] = tuple(item[0] for item in entries); envelope.extend(item[1] for item in entries)
        sender, sender_addr = _strict_address(self._account.email)
        message = EmailMessage(policy=policy.SMTP)
        message["From"] = sender
        if parsed["to"]: message["To"] = list(parsed["to"])
        if parsed["cc"]: message["Cc"] = list(parsed["cc"])
        message["Subject"] = draft.subject
        now = self._clock()
        if not isinstance(now, datetime) or now.tzinfo is None: raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        message["Date"] = format_datetime(now); message["Message-ID"] = make_msgid(domain=sender_addr.split("@", 1)[1])
        if reply:
            message["In-Reply-To"] = reply["messageId"]
            message["References"] = " ".join((*reply.get("references", ()), reply["messageId"]))
        if draft.text is not None:
            message.set_content(draft.text)
            if draft.html is not None: message.add_alternative(draft.html, subtype="html")
        else: message.set_content(draft.html or "", subtype="html")
        raw = message.as_bytes()
        if len(raw) > min(MAX_UPLOAD, self._session()["capabilities"][CORE]["maxSizeUpload"]): raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return raw, tuple(envelope)

    def _upload(self, raw: bytes) -> str:
        session = self._session(); url = session["uploadUrl"].replace("{accountId}", quote(session["_accountId"], safe=""))
        _validate_url(url, API_HOSTS)
        headers = {"Authorization": "Bearer " + self._token, "Accept": "application/json", "Content-Type": "message/rfc822"}
        try: response = self._http.request("POST", url, headers=headers, body=raw, timeout=self._timeout)
        except (OSError, TimeoutError, socket.timeout, URLError) as exc: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True) from exc
        try:
            if response.status == 401: self._session_cache = None; raise MailRuntimeError(ErrorCode.AUTH_EXPIRED)
            if response.status == 403: raise MailRuntimeError(ErrorCode.PERMISSION_DENIED, retryable=False)
            if response.status == 429: raise MailRuntimeError(ErrorCode.RATE_LIMITED, retryable=False)
            if response.status < 200 or response.status >= 300:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False,
                                       ambiguous=response.status >= 500)
            value = _json_response(response, 512 * 1024)
        except MailRuntimeError as exc:
            if exc.code == ErrorCode.UPSTREAM_UNAVAILABLE and response.status < 300:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True) from exc
            raise
        finally: response.close()
        if (value.get("accountId") != session["_accountId"]
                or value.get("type") != "message/rfc822"
                or type(value.get("size")) is not int
                or value.get("size") != len(raw)):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        try:
            return _safe_id(value.get("blobId"), upstream=True)
        except MailRuntimeError as exc:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True) from exc

    def _cleanup(self, email_id: str) -> bool:
        try:
            account_id = self._session()["_accountId"]
            value = self._jmap([("Email/set", {"accountId": account_id, "destroy": [email_id]}, "cleanup")], mutation=True)[0]
            normalized = _set_response(value, account_id)
            return normalized["destroyed"] == [email_id] and not normalized["notDestroyed"]
        except Exception:
            return False

    def _set_error(self, stage: str, value: Any) -> MailRuntimeError:
        kind = value.get("type") if isinstance(value, dict) else None
        invalid = ({"invalidEmail", "tooLarge", "invalidProperties", "invalidArguments"}
                   if stage == "import" else
                   {"invalidRecipients", "noRecipients", "tooManyRecipients", "invalidEmail",
                    "invalidProperties", "invalidArguments"})
        forbidden = ({"forbidden"} if stage == "import" else
                     {"forbiddenMailFrom", "forbiddenFrom", "forbiddenToSend", "forbidden"})
        if kind in invalid:
            return MailRuntimeError(ErrorCode.INVALID_REQUEST, retryable=False)
        if kind in forbidden or kind in {"overQuota", "quota"}:
            return MailRuntimeError(ErrorCode.PERMISSION_DENIED, retryable=False)
        if kind == "notFound":
            return MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False)
        if kind in {"rateLimit", "tooManyRequests"}:
            return MailRuntimeError(ErrorCode.RATE_LIMITED, retryable=False)
        if kind == "serverPartialFail":
            return MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        return MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False)

    def _send(self, draft: Draft, reply: Mapping[str, Any] | None, result_type):
        raw, recipients = self._outbound(draft, reply)
        blob_id = self._upload(raw)
        account_id = self._session()["_accountId"]; draft_box = self._mailbox_roles()["drafts"]
        draft_id = None
        try:
            imported = self._jmap([("Email/import", {"accountId": account_id, "emails": {"draft": {"blobId": blob_id, "mailboxIds": {draft_box: True}, "keywords": {"$draft": True}}}}, "m1")], mutation=True)[0]
            import_set = _set_response(imported, account_id)
            import_created, import_failed = import_set["created"], import_set["notCreated"]
            if set(import_created) | set(import_failed) != {"draft"} or set(import_created) & set(import_failed):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
            if "draft" in import_failed:
                raise self._set_error("import", import_failed["draft"])
            created = import_created.get("draft")
            if not isinstance(created, dict): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
            try:
                draft_id = _safe_id(created.get("id"), upstream=True)
                _safe_id(created.get("blobId"), upstream=True)
                _safe_id(created.get("threadId"), upstream=True)
                size = created.get("size")
                if type(size) is not int or not 0 <= size <= MAX_UPLOAD:
                    raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            except MailRuntimeError as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True) from exc
            identity_response = self._jmap([("Identity/get", {"accountId": account_id}, "m1")])[0]
            _account_response(identity_response, account_id); _state(identity_response.get("state"))
            identities = identity_response.get("list")
            if not isinstance(identities, list) or not isinstance(identity_response.get("notFound", []), list): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            identity_ids = [_safe_id(item.get("id"), upstream=True) for item in identities if isinstance(item, dict)]
            if len(identity_ids) != len(identities) or len(identity_ids) != len(set(identity_ids)): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            identity = next((item for item in identities if isinstance(item, dict) and str(item.get("email", "")).casefold() == self._account.email.casefold()), None)
            if identity is None: raise MailRuntimeError(ErrorCode.PERMISSION_DENIED)
            identity_id = _safe_id(identity.get("id"), upstream=True)
            sender = _strict_address(self._account.email)[1]
            create = {"submit": {"identityId": identity_id, "emailId": draft_id, "envelope": {"mailFrom": {"email": sender}, "rcptTo": [{"email": item} for item in recipients]}}}
            on_success = {"#submit": {"keywords/$draft": None,
                                       f"mailboxIds/{draft_box}": None,
                                       f"mailboxIds/{self._mailbox_roles()['sent']}": True}}
            submitted = self._submission_set({"accountId": account_id, "create": create,
                                              "onSuccessUpdateEmail": on_success}, draft_id)
            submit_created, submit_failed = submitted["created"], submitted["notCreated"]
            if "submit" in submit_failed:
                raise self._set_error("submission", submit_failed["submit"])
            record = submit_created.get("submit")
            if not isinstance(record, dict): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
            try:
                _safe_id(record.get("id"), upstream=True)
            except MailRuntimeError as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True) from exc
            # Submission creation confirms queuing, not final per-recipient delivery.
            return result_type(draft_id, (), (), False)
        except MailRuntimeError as exc:
            if exc.ambiguous:
                raise
            if draft_id is not None and not self._cleanup(draft_id):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True) from exc
            raise

    def send_message(self, draft: Draft) -> SendResult:
        return self._send(draft, None, SendResult)

    def reply_message(self, message_id: str, draft: Draft) -> ReplyResult:
        message_id = _safe_id(message_id)
        rows = self._email_get([message_id])
        if len(rows) != 1: raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        row = rows[0]
        message_ids = row.get("messageId")
        if not isinstance(message_ids, list) or len(message_ids) != 1 or not isinstance(message_ids[0], str): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        original = _message_identifier(message_ids[0])
        references = row.get("references", [])
        if not isinstance(references, list) or len(references) > 50 or not all(isinstance(item, str) for item in references): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        safe_references = tuple(_message_identifier(item) for item in references)
        if sum(len(item) + 1 for item in safe_references) + len(original) > 4096:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if not draft.to:
            targets = _addresses(row.get("replyTo")) or _addresses(row.get("from"))
            if not targets: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            draft = Draft((targets[0],), draft.cc, draft.bcc, draft.subject, draft.text, draft.html)
        subject = draft.subject or (_text(row.get("subject", "")) or "")
        if not subject.casefold().startswith("re:"): subject = "Re: " + subject
        if len(subject) > 998 or "\r" in subject or "\n" in subject:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        draft = Draft(draft.to, draft.cc, draft.bcc, subject, draft.text, draft.html)
        return self._send(draft, {"messageId": original, "references": safe_references}, ReplyResult)

    def delete_message(self, message_id: str) -> DeleteResult:
        message_id = _safe_id(message_id); roles = self._mailbox_roles(); account_id = self._session()["_accountId"]
        rows = self._email_get([message_id])
        if len(rows) != 1: raise MailRuntimeError(ErrorCode.MESSAGE_NOT_FOUND)
        mailbox_ids = rows[0].get("mailboxIds")
        if (not isinstance(mailbox_ids, dict) or not mailbox_ids
                or not all(isinstance(key, str) and value is True for key, value in mailbox_ids.items())):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        if mailbox_ids == {roles["trash"]: True}: return DeleteResult(message_id, "trash")
        value = self._jmap([("Email/set", {"accountId": account_id, "update": {message_id: {"mailboxIds": {roles["trash"]: True}}}}, "m1")], mutation=True)[0]
        normalized = _set_response(value, account_id)
        if set(normalized["updated"]) != {message_id} or normalized["notUpdated"]:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, retryable=False, ambiguous=True)
        return DeleteResult(message_id, "trash")
    def probe_connection(self) -> None:
        self._session()
