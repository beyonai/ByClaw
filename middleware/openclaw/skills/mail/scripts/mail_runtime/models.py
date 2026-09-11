from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping


class ErrorCode(str, Enum):
    ACCOUNT_NOT_FOUND = "ACCOUNT_NOT_FOUND"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    AUTH_EXPIRED = "AUTH_EXPIRED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    MESSAGE_NOT_FOUND = "MESSAGE_NOT_FOUND"
    ATTACHMENT_NOT_FOUND = "ATTACHMENT_NOT_FOUND"
    RATE_LIMITED = "RATE_LIMITED"
    UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE"
    UNSUPPORTED = "UNSUPPORTED"
    INVALID_REQUEST = "INVALID_REQUEST"
    INTERNAL_ERROR = "INTERNAL_ERROR"


ERROR_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.ACCOUNT_NOT_FOUND: "未找到邮箱账户",
    ErrorCode.AUTH_REQUIRED: "邮箱账户尚未连接",
    ErrorCode.AUTH_EXPIRED: "邮箱授权已过期，请重新连接",
    ErrorCode.PERMISSION_DENIED: "没有权限执行此邮箱操作",
    ErrorCode.MESSAGE_NOT_FOUND: "未找到邮件",
    ErrorCode.ATTACHMENT_NOT_FOUND: "未找到附件",
    ErrorCode.RATE_LIMITED: "邮箱服务请求过于频繁，请稍后重试",
    ErrorCode.UPSTREAM_UNAVAILABLE: "邮箱服务暂时不可用，请稍后重试",
    ErrorCode.UNSUPPORTED: "当前邮箱不支持此操作",
    ErrorCode.INVALID_REQUEST: "邮箱请求参数无效",
    ErrorCode.INTERNAL_ERROR: "邮箱操作失败",
}

RETRYABLE_CODES = {ErrorCode.RATE_LIMITED, ErrorCode.UPSTREAM_UNAVAILABLE}


class MailRuntimeError(Exception):
    """Safe error boundary: unsafe caller details are intentionally discarded."""

    def __init__(
        self,
        code: ErrorCode | str,
        _unsafe_detail: str | None = None,
        *,
        retryable: bool | None = None,
        ambiguous: bool = False,
        fallback_safe: bool = False,
        retry_after_ms: int | None = None,
    ) -> None:
        try:
            self.code = code if isinstance(code, ErrorCode) else ErrorCode(code)
        except (TypeError, ValueError):
            self.code = ErrorCode.INTERNAL_ERROR
        self.retryable = self.code in RETRYABLE_CODES if retryable is None else bool(retryable)
        self.ambiguous = bool(ambiguous)
        self.fallback_safe = bool(fallback_safe)
        self.retry_after_ms = (retry_after_ms if type(retry_after_ms) is int
                               and 0 < retry_after_ms <= 3_600_000 else None)
        super().__init__(ERROR_MESSAGES[self.code])

    def as_dict(self) -> dict[str, Any]:
        result = {
            "code": self.code.value,
            "message": ERROR_MESSAGES[self.code],
            "retryable": self.retryable,
            "ambiguous": self.ambiguous,
        }
        if self.retry_after_ms is not None: result["retryAfterMs"] = self.retry_after_ms
        return result


_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def require_text(value: Any, *, allow_empty: bool = False, maximum: int = 4096) -> str:
    if not isinstance(value, str) or len(value) > maximum or _CONTROL.search(value):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    stripped = value.strip()
    if not allow_empty and not stripped:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return value if allow_empty else stripped


def _require_output_string(value: Any, *, optional: bool = False) -> None:
    if value is None and optional:
        return
    if type(value) is not str:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


@dataclass(frozen=True)
class AccountSummary:
    account_id: str
    provider: str
    email: str
    display_name: str
    status: str
    capabilities: tuple[str, ...]
    capability_status: Mapping[str, str] = field(default_factory=dict)
    setup_requirements: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        _validate_account_summary(self)
        return {
            "accountId": self.account_id,
            "provider": self.provider,
            "email": self.email,
            "displayName": self.display_name,
            "status": self.status,
            "capabilities": list(self.capabilities),
            "capabilityStatus": dict(self.capability_status),
            "setupRequirements": list(self.setup_requirements),
        }


@dataclass(frozen=True)
class AccountConfig:
    account_id: str
    provider: str
    email: str
    display_name: str
    status: str
    capabilities: tuple[str, ...]
    auth: Mapping[str, Any] = field(repr=False)
    server: Mapping[str, Any] = field(default_factory=dict, repr=False)
    capability_status: Mapping[str, str] = field(default_factory=dict)
    setup_requirements: tuple[str, ...] = ()
    locator_key: str | None = field(default=None, repr=False)

    @classmethod
    def from_mapping(cls, value: Any) -> "AccountConfig":
        if not isinstance(value, dict):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        capabilities = value.get("capabilities")
        auth = value.get("auth")
        server = value.get("server", {})
        raw_status = value.get("capabilityStatus", {})
        raw_setup = value.get("setupRequirements", [])
        if "default" in value:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if not isinstance(capabilities, list) or not all(isinstance(item, str) for item in capabilities):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        safe_capabilities = tuple(require_text(item, maximum=64) for item in capabilities)
        if len(set(safe_capabilities)) != len(safe_capabilities):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if not isinstance(auth, dict) or not isinstance(server, dict) or not isinstance(raw_status, dict):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if not all(isinstance(key, str) and isinstance(item, str) for key, item in raw_status.items()):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        safe_status = {
            require_text(key, maximum=64): require_text(item, maximum=64)
            for key, item in raw_status.items()
        }
        if not isinstance(raw_setup, list) or not all(isinstance(item, str) for item in raw_setup):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        safe_setup = tuple(require_text(item, maximum=96) for item in raw_setup)
        require_text(auth.get("type"), maximum=64)
        return cls(
            account_id=require_text(value.get("accountId"), maximum=128),
            provider=require_text(value.get("provider"), maximum=64),
            email=require_text(value.get("email"), maximum=320),
            display_name=require_text(value.get("displayName", ""), allow_empty=True, maximum=256),
            status=require_text(value.get("status", "UNKNOWN"), maximum=64),
            capabilities=safe_capabilities,
            capability_status=safe_status,
            setup_requirements=safe_setup,
            locator_key=value.get("locatorKey"),
            auth=dict(auth),
            server=dict(server),
        )

    def public_summary(self) -> AccountSummary:
        return AccountSummary(
            self.account_id,
            self.provider,
            self.email,
            self.display_name,
            self.status,
            self.capabilities,
            self.capability_status,
            self.setup_requirements,
        )


@dataclass(frozen=True)
class ListRequest:
    folder: str = "inbox"
    limit: int = 20
    cursor: str | None = None


@dataclass(frozen=True)
class SearchRequest:
    query: str
    limit: int = 20
    cursor: str | None = None


@dataclass(frozen=True)
class AttachmentRequest:
    message_id: str
    attachment_id: str


@dataclass(frozen=True)
class Draft:
    to: tuple[str, ...] = field(default=(), repr=False)
    cc: tuple[str, ...] = field(default=(), repr=False)
    bcc: tuple[str, ...] = field(default=(), repr=False)
    subject: str = field(default="", repr=False)
    text: str | None = field(default=None, repr=False)
    html: str | None = field(default=None, repr=False)

    @classmethod
    def from_mapping(cls, value: Any, *, require_recipients: bool) -> "Draft":
        if not isinstance(value, dict):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if set(value) - {"to", "cc", "bcc", "subject", "text", "html"}:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)

        def recipients(name: str) -> tuple[str, ...]:
            raw = value.get(name, [])
            if not isinstance(raw, list) or len(raw) > 100:
                raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
            return tuple(require_text(item, maximum=320) for item in raw)

        to, cc, bcc = recipients("to"), recipients("cc"), recipients("bcc")
        if require_recipients and not (to or cc or bcc):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        subject = require_text(value.get("subject", ""), allow_empty=True, maximum=998)
        text, html = value.get("text"), value.get("html")
        if (text is not None and not isinstance(text, str)) or (html is not None and not isinstance(html, str)):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        if text is None and html is None:
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        from .mime import normalize_body

        return cls(
            to=to,
            cc=cc,
            bcc=bcc,
            subject=subject,
            text=normalize_body(text) if text is not None else None,
            html=normalize_body(html) if html is not None else None,
        )


@dataclass(frozen=True)
class MessageSummary:
    message_id: str
    subject: str = ""
    sender: str | None = None
    received_at: str | None = None
    preview: str | None = None
    has_attachments: bool = False
    sent_at: str | None = None

    def __post_init__(self) -> None:
        _require_output_string(self.message_id)
        _require_output_string(self.subject)
        _require_output_string(self.sender, optional=True)
        _require_output_string(self.received_at, optional=True)
        _require_output_string(self.sent_at, optional=True)
        _require_output_string(self.preview, optional=True)
        if type(self.has_attachments) is not bool:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


@dataclass(frozen=True)
class AttachmentMeta:
    attachment_id: str
    filename: str
    size: int
    content_type: str | None = None

    def __post_init__(self) -> None:
        _require_output_string(self.attachment_id)
        _require_output_string(self.filename)
        _require_output_string(self.content_type, optional=True)
        if type(self.size) is not int or self.size < 0:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


@dataclass(frozen=True)
class MessageContent:
    message_id: str
    subject: str = ""
    sender: str | None = None
    recipients: tuple[str, ...] = ()
    received_at: str | None = None
    text: str | None = None
    html: str | None = None
    attachments: tuple[AttachmentMeta, ...] = ()
    sent_at: str | None = None

    def __post_init__(self) -> None:
        _require_output_string(self.message_id)
        _require_output_string(self.subject)
        _require_output_string(self.sender, optional=True)
        _require_output_string(self.received_at, optional=True)
        _require_output_string(self.sent_at, optional=True)
        _require_output_string(self.text, optional=True)
        _require_output_string(self.html, optional=True)
        if type(self.recipients) is not tuple or not all(type(item) is str for item in self.recipients):
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        if type(self.attachments) is not tuple or not all(
            type(item) is AttachmentMeta for item in self.attachments
        ):
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


@dataclass(frozen=True)
class Page:
    items: tuple[MessageSummary, ...]
    next_cursor: str | None = None

    def __post_init__(self) -> None:
        if type(self.items) is not tuple or not all(type(item) is MessageSummary for item in self.items):
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        _require_output_string(self.next_cursor, optional=True)


@dataclass(frozen=True)
class AttachmentDownloadResult:
    filename: str
    size: int
    content_type: str | None = None
    path: str | None = None

    def __post_init__(self) -> None:
        _require_output_string(self.filename)
        _require_output_string(self.content_type, optional=True)
        _require_output_string(self.path, optional=True)
        if type(self.size) is not int or self.size < 0:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


@dataclass(frozen=True)
class SendResult:
    message_id: str
    accepted: tuple[str, ...] = ()
    rejected: tuple[str, ...] = ()
    partial: bool = False

    def __post_init__(self) -> None:
        _require_output_string(self.message_id)
        if (
            type(self.accepted) is not tuple
            or type(self.rejected) is not tuple
            or not all(type(item) is str for item in self.accepted + self.rejected)
            or type(self.partial) is not bool
        ):
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


@dataclass(frozen=True)
class ReplyResult:
    message_id: str
    accepted: tuple[str, ...] = ()
    rejected: tuple[str, ...] = ()
    partial: bool = False

    def __post_init__(self) -> None:
        _require_output_string(self.message_id)
        if (
            type(self.accepted) is not tuple
            or type(self.rejected) is not tuple
            or not all(type(item) is str for item in self.accepted + self.rejected)
            or type(self.partial) is not bool
        ):
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


@dataclass(frozen=True)
class DeleteResult:
    message_id: str
    moved_to: str = "trash"

    def __post_init__(self) -> None:
        _require_output_string(self.message_id)
        _require_output_string(self.moved_to)


@dataclass(frozen=True)
class ConnectionCheckResult:
    status: str
    latency_ms: int
    capability_status: Mapping[str, str]


def _summary_json(value: MessageSummary) -> dict[str, Any]:
    _validate_message_summary(value)
    return {
        "messageId": value.message_id,
        "subject": value.subject,
        "sender": value.sender,
        "receivedAt": value.received_at,
        "sentAt": value.sent_at,
        "preview": value.preview,
        "hasAttachments": value.has_attachments,
    }


def _attachment_json(value: AttachmentMeta) -> dict[str, Any]:
    _validate_attachment_meta(value)
    return {
        "attachmentId": value.attachment_id,
        "filename": value.filename,
        "size": value.size,
        "contentType": value.content_type,
    }


def _serialized_string(
    value: Any,
    *,
    maximum: int,
    optional: bool = False,
    allow_empty: bool = True,
) -> None:
    if value is None and optional:
        return
    if type(value) is not str or len(value) > maximum or (not allow_empty and not value):
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


def _validate_account_summary(value: Any) -> None:
    if type(value) is not AccountSummary:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    _serialized_string(value.account_id, maximum=128, allow_empty=False)
    _serialized_string(value.provider, maximum=64, allow_empty=False)
    _serialized_string(value.email, maximum=320, allow_empty=False)
    _serialized_string(value.display_name, maximum=256)
    _serialized_string(value.status, maximum=64, allow_empty=False)
    if type(value.capabilities) is not tuple:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    if len(value.capabilities) > 64:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    for capability in value.capabilities:
        _serialized_string(capability, maximum=64, allow_empty=False)
    if not isinstance(value.capability_status, Mapping) or len(value.capability_status) > 64:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    for capability, status in value.capability_status.items():
        _serialized_string(capability, maximum=64, allow_empty=False)
        _serialized_string(status, maximum=64, allow_empty=False)
    if type(value.setup_requirements) is not tuple or len(value.setup_requirements) > 32:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    for requirement in value.setup_requirements:
        _serialized_string(requirement, maximum=96, allow_empty=False)


def _validate_message_summary(value: Any) -> None:
    if type(value) is not MessageSummary:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    _serialized_string(value.sent_at, maximum=256, optional=True)
    _serialized_string(value.message_id, maximum=4096, allow_empty=False)
    _serialized_string(value.subject, maximum=65536)
    _serialized_string(value.sender, maximum=4096, optional=True)
    _serialized_string(value.received_at, maximum=256, optional=True)
    _serialized_string(value.preview, maximum=65536, optional=True)
    if type(value.has_attachments) is not bool:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


def _validate_attachment_meta(value: Any) -> None:
    if type(value) is not AttachmentMeta:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    _serialized_string(value.attachment_id, maximum=4096, allow_empty=False)
    _serialized_string(value.filename, maximum=1024, allow_empty=False)
    _serialized_string(value.content_type, maximum=512, optional=True)
    if type(value.size) is not int or value.size < 0 or value.size > (1 << 63) - 1:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


def _validate_page(value: Any) -> None:
    if type(value) is not Page or type(value.items) is not tuple or len(value.items) > 1000:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    _serialized_string(value.next_cursor, maximum=65536, optional=True)
    for item in value.items:
        _validate_message_summary(item)


def _validate_message_content(value: Any) -> None:
    if type(value) is not MessageContent:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    _serialized_string(value.sent_at, maximum=256, optional=True)
    _serialized_string(value.message_id, maximum=4096, allow_empty=False)
    _serialized_string(value.subject, maximum=65536)
    _serialized_string(value.sender, maximum=4096, optional=True)
    _serialized_string(value.received_at, maximum=256, optional=True)
    _serialized_string(value.text, maximum=10 * 1024 * 1024, optional=True)
    _serialized_string(value.html, maximum=10 * 1024 * 1024, optional=True)
    if type(value.recipients) is not tuple or len(value.recipients) > 1000:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    for recipient in value.recipients:
        _serialized_string(recipient, maximum=4096, allow_empty=False)
    if type(value.attachments) is not tuple or len(value.attachments) > 1000:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    for attachment in value.attachments:
        _validate_attachment_meta(attachment)


def _validate_download_result(value: Any) -> None:
    if type(value) is not AttachmentDownloadResult:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
    _serialized_string(value.filename, maximum=240, allow_empty=False)
    _serialized_string(value.content_type, maximum=512, optional=True)
    _serialized_string(value.path, maximum=4096, optional=True)
    if type(value.size) is not int or value.size < 0 or value.size > (1 << 63) - 1:
        raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)


def to_jsonable(value: Any) -> Any:
    """Serialize only the public runtime DTO allowlist."""
    if value is None or type(value) in {str, int, float, bool}:
        return value
    if type(value) in {list, tuple}:
        return [to_jsonable(item) for item in value]
    if type(value) is AccountSummary:
        _validate_account_summary(value)
        return value.to_dict()
    if type(value) is MessageSummary:
        return _summary_json(value)
    if type(value) is AttachmentMeta:
        return _attachment_json(value)
    if type(value) is Page:
        _validate_page(value)
        return {"items": [_summary_json(item) for item in value.items], "nextCursor": value.next_cursor}
    if type(value) is MessageContent:
        _validate_message_content(value)
        return {
            "messageId": value.message_id,
            "subject": value.subject,
            "sender": value.sender,
            "recipients": list(value.recipients),
            "receivedAt": value.received_at,
            "sentAt": value.sent_at,
            "text": value.text,
            "html": value.html,
            "attachments": [_attachment_json(item) for item in value.attachments],
        }
    if type(value) is AttachmentDownloadResult:
        _validate_download_result(value)
        return {
            "filename": value.filename,
            "size": value.size,
            "contentType": value.content_type,
            "path": value.path,
        }
    if type(value) is SendResult or type(value) is ReplyResult:
        _serialized_string(value.message_id, maximum=4096, allow_empty=False)
        if type(value.accepted) is not tuple or type(value.rejected) is not tuple or type(value.partial) is not bool:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        for address in value.accepted + value.rejected:
            _serialized_string(address, maximum=320, allow_empty=False)
        return {
            "messageId": value.message_id,
            "accepted": list(value.accepted),
            "rejected": list(value.rejected),
            "partial": value.partial,
        }
    if type(value) is DeleteResult:
        _serialized_string(value.message_id, maximum=4096, allow_empty=False)
        _serialized_string(value.moved_to, maximum=256, allow_empty=False)
        return {"messageId": value.message_id, "movedTo": value.moved_to}
    if type(value) is ConnectionCheckResult:
        if value.status not in {"NORMAL", "PARTIAL"}:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        if type(value.latency_ms) is not int or value.latency_ms < 0 or value.latency_ms > 3_600_000:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        if type(value.capability_status) is not dict or set(value.capability_status) != {
            "list", "get", "search", "downloadAttachment", "send", "reply", "delete"
        }:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        for status in value.capability_status.values():
            _serialized_string(status, maximum=64, allow_empty=False)
        return {
            "status": value.status,
            "latencyMs": value.latency_ms,
            "capabilityStatus": dict(value.capability_status),
        }
    raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
