from __future__ import annotations

from collections.abc import Callable
from typing import Protocol, runtime_checkable

from .io_security import AttachmentSink
from .models import (
    AccountConfig,
    AttachmentDownloadResult,
    AttachmentRequest,
    DeleteResult,
    Draft,
    ErrorCode,
    ListRequest,
    MailRuntimeError,
    MessageContent,
    Page,
    ReplyResult,
    SearchRequest,
    SendResult,
)


CAPABILITY_NAMES = (
    "list",
    "get",
    "search",
    "downloadAttachment",
    "send",
    "reply",
    "delete",
)


@runtime_checkable
class MailAdapter(Protocol):
    def probe_connection(self) -> None: ...
    def list_messages(self, request: ListRequest) -> Page: ...
    def get_message(self, message_id: str) -> MessageContent: ...
    def search_messages(self, request: SearchRequest) -> Page: ...
    def download_attachment(
        self, request: AttachmentRequest, sink: AttachmentSink
    ) -> AttachmentDownloadResult: ...
    def send_message(self, draft: Draft) -> SendResult: ...
    def reply_message(self, message_id: str, draft: Draft) -> ReplyResult: ...
    def delete_message(self, message_id: str) -> DeleteResult: ...


AdapterFactory = Callable[[AccountConfig], MailAdapter]
ADAPTER_METHODS = (
    "probe_connection",
    "list_messages",
    "get_message",
    "search_messages",
    "download_attachment",
    "send_message",
    "reply_message",
    "delete_message",
)


class AdapterRegistry:
    def __init__(self) -> None:
        self._factories: dict[str, AdapterFactory] = {}

    def register(self, provider: str, factory: AdapterFactory) -> None:
        if not provider or provider in self._factories or not callable(factory):
            raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
        self._factories[provider] = factory

    def adapter_for(self, account: AccountConfig) -> MailAdapter:
        factory = self._factories.get(account.provider)
        if factory is None:
            raise MailRuntimeError(ErrorCode.UNSUPPORTED)
        try:
            adapter = factory(account)
        except MailRuntimeError:
            raise
        except Exception as exc:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR) from exc
        if not isinstance(adapter, MailAdapter) or not all(
            callable(getattr(adapter, method, None)) for method in ADAPTER_METHODS
        ):
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        return adapter

    def probe(self, account: AccountConfig) -> dict[str, str]:
        """Perform the smallest non-mutating read and return metadata only."""
        adapter = self.adapter_for(account)
        result = adapter.probe_connection()
        if result is not None:
            raise MailRuntimeError(ErrorCode.INTERNAL_ERROR)
        statuses = {
            capability: account.capability_status.get(
                capability, "YES" if capability in account.capabilities else "NO"
            )
            for capability in CAPABILITY_NAMES
        }
        return statuses


def build_default_registry() -> AdapterRegistry:
    """Build the runtime registry without import-time provider side effects."""
    from .gmail import GmailAdapter
    from .fastmail_jmap import FastmailJmapAdapter
    from .imap_smtp import ImapSmtpAdapter
    from .microsoft_graph import MicrosoftGraphAdapter

    registry = AdapterRegistry()
    registry.register("gmail", GmailAdapter)
    registry.register("fastmail", FastmailJmapAdapter)
    registry.register("microsoft-365", MicrosoftGraphAdapter)
    for provider in ("imap_smtp", "qq", "netease-163", "aliyun-mail", "custom-imap"):
        registry.register(provider, ImapSmtpAdapter)
    return registry
