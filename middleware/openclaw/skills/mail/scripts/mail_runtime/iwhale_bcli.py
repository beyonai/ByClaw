from __future__ import annotations

import base64
import binascii
import json
import os
import subprocess
import tempfile
from collections.abc import Callable
from typing import Any

from .ews import (
    EwsAdapter, MAX_ATTACHMENT_BYTES, PostDispatchProcessError, PreDispatchProcessError,
    bounded_run, enterprise_auth_usable,
)
from .io_security import AttachmentSink
from .locator_security import locator_key, sign_locator, verify_locator
from .mime import safe_filename
from .models import (
    AccountConfig, AttachmentDownloadResult, AttachmentMeta, AttachmentRequest, DeleteResult,
    Draft, ErrorCode, ListRequest, MailRuntimeError, MessageContent, MessageSummary, Page,
    ReplyResult, SearchRequest, SendResult,
)

MAX_OUTPUT_BYTES = 10 * 1024 * 1024
DEFAULT_TIMEOUT = 30.0
_AUTO = object()


def _private_json(value: dict[str, Any]) -> str:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    if len(raw) > 1024 * 1024:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    fd, name = tempfile.mkstemp(prefix="byclaw-bycli-mail-", suffix=".json")
    try:
        os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(raw):
            written = os.write(fd, raw[offset:])
            if written <= 0: raise OSError("short private-file write")
            offset += written
    finally:
        os.close(fd)
    return name


def _string(value: Any, maximum: int = 65536, *, optional: bool = False) -> str | None:
    if value is None and optional: return None
    if not isinstance(value, str) or len(value.encode()) > maximum or "\x00" in value:
        raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
    return value


class BycliOwaAdapter:
    def __init__(self, account: AccountConfig, *, runner: Callable[..., Any] = bounded_run,
                 timeout: float = DEFAULT_TIMEOUT) -> None:
        if account.provider != "iwhalecloud" or not 0 < timeout <= DEFAULT_TIMEOUT:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        self._account, self._runner, self._timeout = account, runner, float(timeout)
        self._locator_key = locator_key(account.locator_key)

    def _context(self, object_type: str) -> dict[str, Any]:
        return {"v": 1, "p": "iwhalecloud", "a": self._account.account_id,
                "e": self._account.email.strip().lower(), "o": object_type}

    def _message_locator(self, value: Any) -> dict[str, Any]:
        data = verify_locator(value, "iwm1", self._context("message"), self._locator_key)
        if set(data) != {"v", "p", "a", "e", "o", "i", "c"} or not isinstance(data.get("i"), str) or not isinstance(data.get("c"), str):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return data

    def _attachment_locator(self, value: Any, message: dict[str, Any]) -> dict[str, Any]:
        data = verify_locator(value, "iwa1", {**self._context("attachment"), "i": message["i"], "c": message["c"]}, self._locator_key)
        if set(data) != {"v", "p", "a", "e", "o", "i", "c", "x"} or not isinstance(data.get("x"), str):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        return data

    def _encode_message(self, value: Any) -> str:
        message = self._response_message(value)
        return sign_locator("iwm1", {**self._context("message"), **message}, self._locator_key)

    def _response_message(self, value: Any, expected_id: str | None = None) -> dict[str, str]:
        if not isinstance(value, dict): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        item_id, change_key = value.get("id"), value.get("changeKey")
        if (set(value) != {"id", "changeKey"} or not isinstance(item_id, str)
                or not isinstance(change_key, str) or (expected_id is not None and item_id != expected_id)):
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return {"i": item_id, "c": change_key}

    def _encode_attachment(self, value: Any, message: dict[str, Any]) -> str:
        if not isinstance(value, str): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return sign_locator("iwa1", {**self._context("attachment"), "i": message["i"], "c": message["c"], "x": value}, self._locator_key)

    def _invoke(self, operation: str, request: dict[str, Any], *, mutation: bool = False) -> dict[str, Any]:
        path = _private_json({"schemaVersion": 1, "accountId": self._account.account_id,
                              "accountEmail": self._account.email.strip().lower(), **request})
        argv = ["bycli", "mail-iwhalecloud", operation, "-f", "json", "--input", path]
        try:
            try:
                result = self._runner(argv, capture_output=True, timeout=self._timeout, check=False)
            except (TimeoutError, subprocess.TimeoutExpired) as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation) from exc
            except PreDispatchProcessError as exc:
                raise MailRuntimeError(ErrorCode.UNSUPPORTED, fallback_safe=True) from exc
            except PostDispatchProcessError as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation) from exc
            except OSError as exc:
                raise MailRuntimeError(ErrorCode.UNSUPPORTED, fallback_safe=True) from exc
            stdout = result.stdout if isinstance(result.stdout, bytes) else str(result.stdout or "").encode()
            stderr = result.stderr if isinstance(result.stderr, bytes) else str(result.stderr or "").encode()
            if len(stdout) > MAX_OUTPUT_BYTES or len(stderr) > MAX_OUTPUT_BYTES:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation)
            if result.returncode != 0:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation)
            try:
                text = stdout.decode("utf-8")
                decoder = json.JSONDecoder(); value, end = decoder.raw_decode(text.lstrip())
                if text.lstrip()[end:].strip(): raise ValueError()
            except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation) from exc
            if not isinstance(value, dict):
                raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE, ambiguous=mutation)
            error = value.get("error")
            if error is not None:
                code = error.get("code") if isinstance(error, dict) else None
                mapping = {item.value: item for item in ErrorCode}
                retryable = error.get("retryable") if isinstance(error, dict) else None
                if type(retryable) is not bool: retryable = None
                retry_after = error.get("retryAfterMs") if isinstance(error, dict) else None
                raise MailRuntimeError(mapping.get(code, ErrorCode.UPSTREAM_UNAVAILABLE),
                                       retryable=False if mutation else retryable, ambiguous=mutation,
                                       retry_after_ms=retry_after)
            return value
        finally:
            try: os.unlink(path)
            except FileNotFoundError: pass

    def _summary(self, value: Any) -> MessageSummary:
        if not isinstance(value, dict): raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return MessageSummary(
            self._encode_message(value.get("messageId")), _string(value.get("subject", "")) or "",
            _string(value.get("sender"), 4096, optional=True), _string(value.get("receivedAt"), 256, optional=True),
            _string(value.get("preview"), optional=True), value.get("hasAttachments", False),
        )

    def probe_connection(self) -> None:
        value = self._invoke("probe", {})
        if value:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)

    def list_messages(self, request: ListRequest) -> Page:
        value = self._invoke("list", {"folder": request.folder, "limit": request.limit, "cursor": request.cursor})
        items = value.get("items")
        if not isinstance(items, list) or len(items) > 100: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return Page(tuple(self._summary(item) for item in items), _string(value.get("nextCursor"), 65536, optional=True))

    def search_messages(self, request: SearchRequest) -> Page:
        value = self._invoke("search", {"query": request.query, "limit": request.limit, "cursor": request.cursor})
        items = value.get("items")
        if not isinstance(items, list) or len(items) > 100: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return Page(tuple(self._summary(item) for item in items), _string(value.get("nextCursor"), 65536, optional=True))

    def get_message(self, message_id: str) -> MessageContent:
        message = self._message_locator(message_id)
        value = self._invoke("get", {"messageId": {"id": message["i"], "changeKey": message["c"]}})
        returned_message = self._response_message(value.get("messageId"), expected_id=message["i"])
        recipients = value.get("recipients", []); attachments = value.get("attachments", [])
        if not isinstance(recipients, list) or len(recipients) > 100 or not isinstance(attachments, list) or len(attachments) > 100:
            raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        metas = []
        for item in attachments:
            if not isinstance(item, dict) or type(item.get("size")) is not int: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
            metas.append(AttachmentMeta(self._encode_attachment(item.get("attachmentId"), returned_message), safe_filename(_string(item.get("filename"), 1024) or "attachment"), item["size"], _string(item.get("contentType"), 512, optional=True)))
        return MessageContent(self._encode_message(value.get("messageId")), _string(value.get("subject", "")) or "",
                              _string(value.get("sender"), 4096, optional=True), tuple(_string(x, 4096) or "" for x in recipients),
                              _string(value.get("receivedAt"), 256, optional=True), _string(value.get("text"), 10 * 1024 * 1024, optional=True),
                              _string(value.get("html"), 10 * 1024 * 1024, optional=True), tuple(metas))

    def download_attachment(self, request: AttachmentRequest, sink: AttachmentSink) -> AttachmentDownloadResult:
        message = self._message_locator(request.message_id)
        attachment = self._attachment_locator(request.attachment_id, message)
        value = self._invoke("downloadAttachment", {"messageId": {"id": message["i"], "changeKey": message["c"]}, "attachmentId": attachment["x"]})
        encoded = _string(value.get("contentBase64"), MAX_ATTACHMENT_BYTES * 4 // 3 + 8) or ""
        try: content = base64.b64decode(encoded, validate=True)
        except binascii.Error as exc: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE) from exc
        if len(content) > MAX_ATTACHMENT_BYTES: raise MailRuntimeError(ErrorCode.UPSTREAM_UNAVAILABLE)
        return sink.write(safe_filename(_string(value.get("filename"), 1024) or "attachment"), (content,),
                          content_type=_string(value.get("contentType"), 512, optional=True))

    @staticmethod
    def _draft(draft: Draft) -> dict[str, Any]:
        return {"to": list(draft.to), "cc": list(draft.cc), "bcc": list(draft.bcc), "subject": draft.subject, "text": draft.text, "html": draft.html}

    def send_message(self, draft: Draft) -> SendResult:
        value = self._invoke("send", {"draft": self._draft(draft)}, mutation=True)
        try:
            return SendResult(self._encode_message(value.get("messageId")), draft.to + draft.cc + draft.bcc)
        except MailRuntimeError as exc:
            raise MailRuntimeError(exc.code, retryable=False, ambiguous=True) from exc

    def reply_message(self, message_id: str, draft: Draft) -> ReplyResult:
        message = self._message_locator(message_id)
        value = self._invoke("reply", {"messageId": {"id": message["i"], "changeKey": message["c"]}, "draft": self._draft(draft)}, mutation=True)
        try:
            return ReplyResult(self._encode_message(value.get("messageId")))
        except MailRuntimeError as exc:
            raise MailRuntimeError(exc.code, retryable=False, ambiguous=True) from exc

    def delete_message(self, message_id: str) -> DeleteResult:
        message = self._message_locator(message_id)
        value = self._invoke("delete", {"messageId": {"id": message["i"], "changeKey": message["c"]}}, mutation=True)
        try:
            return DeleteResult(self._encode_message(value.get("messageId")), _string(value.get("movedTo", "trash"), 256) or "trash")
        except MailRuntimeError as exc:
            raise MailRuntimeError(exc.code, retryable=False, ambiguous=True) from exc


class IWhaleCloudAdapter:
    _METHODS = {"probe_connection": False, "list_messages": False, "get_message": False, "search_messages": False,
                "download_attachment": False, "send_message": True, "reply_message": True, "delete_message": True}

    def __init__(self, account: AccountConfig, *, ews: Any = _AUTO, browser: Any = _AUTO) -> None:
        self._browser = BycliOwaAdapter(account) if browser is _AUTO else browser
        if ews is _AUTO:
            self._ews = EwsAdapter(account) if enterprise_auth_usable(account) else None
        else:
            self._ews = ews

    def _call(self, name: str, *args: Any) -> Any:
        mutation = self._METHODS[name]
        if self._ews is None: return getattr(self._browser, name)(*args)
        try:
            return getattr(self._ews, name)(*args)
        except MailRuntimeError as exc:
            deterministic = exc.code in {ErrorCode.AUTH_REQUIRED, ErrorCode.AUTH_EXPIRED, ErrorCode.UNSUPPORTED}
            if deterministic and not exc.ambiguous and (not mutation or exc.fallback_safe):
                return getattr(self._browser, name)(*args)
            raise

    def probe_connection(self): return self._call("probe_connection")
    def list_messages(self, request): return self._call("list_messages", request)
    def get_message(self, message_id): return self._call("get_message", message_id)
    def search_messages(self, request): return self._call("search_messages", request)
    def download_attachment(self, request, sink): return self._call("download_attachment", request, sink)
    def send_message(self, draft): return self._call("send_message", draft)
    def reply_message(self, message_id, draft): return self._call("reply_message", message_id, draft)
    def delete_message(self, message_id): return self._call("delete_message", message_id)
