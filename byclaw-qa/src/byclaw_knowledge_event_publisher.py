"""ByClaw transport adapter for by-qa's unified knowledge events."""

from __future__ import annotations

import inspect
import json
import os
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

import httpx

from by_framework.core.discovery import DiscoveryClient
from by_qa.config import get_settings
from by_qa.core import logger
from by_qa.knowledge_base.events import (
    BuildFileCompletedEvent,
    DirectoryCreatedEvent,
    DirectoryDeletedEvent,
    DirectoryUpdatedEvent,
    DiscoveryBatchCompletedEvent,
    DiscoveryFileCompletedEvent,
    EnrichBatchCompletedEvent,
    EnrichFileCompletedEvent,
    FileDeletedEvent,
    FileImportedEvent,
    FileUpdatedEvent,
    KnowledgeEvent,
    ResourceMovedEvent,
)
from by_qa.knowledge_base.infrastructure.database import build_connection_factory
from by_qa.knowledge_base.repositories.knowledge_base_repository import (
    KnowledgeBaseRepository,
)
from by_qa.knowledge_base.repositories.knowledge_semantic_processing_batch_repository import (
    KnowledgeSemanticProcessingBatchRepository,
)

from byclaw_userfs_storage import (
    CHAT_SESSION_ID_HEADER,
    RESOURCE_ID_HEADER,
    USER_CODE_HEADER,
    get_byclaw_userfs_header_context,
)
from redis_runtime import init_shared_redis_from_env

SAVE_OR_UPDATE_OBJECT_FILES_PATH = (
    "/byaiService/devloop/operation/saveOrUpdateObjectFiles"
)
CALLBACK_CONTEXT_EXTRA_PARAM = "_byclawCallbackContext"
EVENT_PUBLISHER_PROVIDER_PATH = (
    "byclaw_knowledge_event_publisher:build_byclaw_knowledge_event_publisher"
)
_TIMEOUT_SECONDS = 30.0

PostJson = Callable[
    [str, dict[str, Any], dict[str, str]],
    Mapping[str, Any] | Awaitable[Mapping[str, Any]],
]
BeyondTokenResolver = Callable[[str], str | Awaitable[str]]
KnowledgeBaseResolver = Callable[
    [str], Mapping[str, Any] | Awaitable[Mapping[str, Any]]
]
BatchContextResolver = Callable[
    [str, str], Mapping[str, Any] | Awaitable[Mapping[str, Any]]
]


@dataclass(frozen=True, slots=True)
class ByClawCallbackContext:
    user_code: str = ""
    chat_session_id: str = ""
    resource_id: str = ""

    @property
    def deliverable(self) -> bool:
        return bool(self.user_code and self.chat_session_id)


class ByClawKnowledgeEventPublisherError(RuntimeError):
    """Raised when an event cannot be delivered to ByClaw BE."""


@dataclass(slots=True)
class ByClawKnowledgeEventPublisher:
    """Translate strict by-qa events into ByClaw knowledge object updates."""

    post_json: PostJson | None = None
    beyond_token_resolver: BeyondTokenResolver | None = None
    knowledge_base_resolver: KnowledgeBaseResolver | None = None
    batch_context_resolver: BatchContextResolver | None = None

    async def publish(self, event: KnowledgeEvent) -> None:
        if isinstance(event, DiscoveryBatchCompletedEvent | EnrichBatchCompletedEvent):
            logger.info(
                "byclaw knowledge event completed: event_type=%s batch_id=%s "
                "completed_count=%s total_count=%s invoke_result=logged_only",
                event.event_type,
                event.payload.batch_id,
                event.payload.progress.completed_count,
                event.payload.progress.total_count,
            )
            return

        context = await self._resolve_context(event)
        if not context.deliverable:
            logger.info(
                "byclaw knowledge event skipped: event_type=%s event_id=%s "
                "invoke_result=skipped_missing_headers has_user_code=%s "
                "has_chat_session_id=%s",
                event.event_type,
                event.event_id,
                bool(context.user_code),
                bool(context.chat_session_id),
            )
            return

        metadata = await self._resolve_knowledge_base(event.kb_code)
        object_files = _build_object_files(event, context=context, metadata=metadata)
        if not object_files:
            logger.info(
                "byclaw knowledge event completed: event_type=%s event_id=%s "
                "invoke_result=no_changed_object_files",
                event.event_type,
                event.event_id,
            )
            return

        headers = {
            "Content-Type": "application/json",
            "Beyond-Token": await self._resolve_beyond_token(context.user_code),
            "X-User-Code": context.user_code,
            "X-CHAT-SESSION-ID": context.chat_session_id,
        }
        payload = {"objectFiles": object_files}
        if self.post_json is None:
            raw = await self._post_by_discovery(payload=payload, headers=headers)
        else:
            response = self.post_json(
                SAVE_OR_UPDATE_OBJECT_FILES_PATH,
                payload,
                headers,
            )
            raw = await response if inspect.isawaitable(response) else response
        _validate_response(raw)
        logger.info(
            "byclaw knowledge event completed: event_type=%s event_id=%s "
            "object_file_count=%s invoke_result=success",
            event.event_type,
            event.event_id,
            len(object_files),
        )

    async def _resolve_context(self, event: KnowledgeEvent) -> ByClawCallbackContext:
        current = _context_from_headers(get_byclaw_userfs_header_context())
        if current.deliverable:
            return current
        if not isinstance(
            event, DiscoveryFileCompletedEvent | EnrichFileCompletedEvent
        ):
            return current
        if self.batch_context_resolver is None:
            raw = await _resolve_batch_context_from_db(
                event.payload.batch_id,
                event.payload.knowledge_base_id,
            )
        else:
            result = self.batch_context_resolver(
                event.payload.batch_id,
                event.payload.knowledge_base_id,
            )
            raw = await result if inspect.isawaitable(result) else result
        return _context_from_extra_params(raw)

    async def _resolve_beyond_token(self, user_code: str) -> str:
        if self.beyond_token_resolver is None:
            return await _resolve_beyond_token_from_redis(user_code)
        result = self.beyond_token_resolver(user_code)
        token = await result if inspect.isawaitable(result) else result
        normalized = str(token or "").strip()
        if not normalized:
            raise ByClawKnowledgeEventPublisherError(
                "Redis login state is missing Beyond-Token"
            )
        return normalized

    async def _resolve_knowledge_base(self, kb_code: str) -> dict[str, str]:
        if self.knowledge_base_resolver is None:
            raw = await _resolve_knowledge_base_from_db(kb_code)
        else:
            result = self.knowledge_base_resolver(kb_code)
            raw = await result if inspect.isawaitable(result) else result
        name = str(raw.get("kb_name") or raw.get("name") or "").strip()
        kb_id = str(raw.get("kid") or raw.get("kb_id") or kb_code).strip()
        if not name:
            raise ByClawKnowledgeEventPublisherError(
                f"Knowledge base name is missing for code: {kb_code}"
            )
        return {"name": name, "id": kb_id}

    async def _post_by_discovery(
        self,
        *,
        payload: dict[str, Any],
        headers: dict[str, str],
    ) -> Mapping[str, Any]:
        service_name = os.getenv("BE_DOMAINNAME", "ByaiService").strip()
        redis_client = init_shared_redis_from_env()
        discovery_client = DiscoveryClient(redis_client=redis_client, cache_interval=5)
        try:
            instance = await discovery_client.discover(
                service_name,
                health_threshold_ms=-1,
            )
            if not instance:
                raise ByClawKnowledgeEventPublisherError(
                    f"No available instances for service: {service_name}"
                )
            url = _build_discovered_url(instance, SAVE_OR_UPDATE_OBJECT_FILES_PATH)
            async with httpx.AsyncClient(
                timeout=_TIMEOUT_SECONDS,
                headers=headers,
            ) as client:
                response = await client.post(url, json=payload)
                try:
                    raw = response.json()
                except ValueError as exc:
                    raise ByClawKnowledgeEventPublisherError(
                        "saveOrUpdateObjectFiles response must be JSON"
                    ) from exc
                if not response.is_success:
                    raise ByClawKnowledgeEventPublisherError(
                        "saveOrUpdateObjectFiles returned HTTP "
                        f"{response.status_code}: {raw}"
                    )
                if not isinstance(raw, Mapping):
                    raise ByClawKnowledgeEventPublisherError(
                        "saveOrUpdateObjectFiles response must be an object"
                    )
                return raw
        except httpx.HTTPError as exc:
            raise ByClawKnowledgeEventPublisherError(
                f"saveOrUpdateObjectFiles HTTP error: {exc}"
            ) from exc
        finally:
            await discovery_client.close()


def build_byclaw_knowledge_event_publisher() -> ByClawKnowledgeEventPublisher:
    return ByClawKnowledgeEventPublisher()


def _context_from_headers(headers: Mapping[str, Any]) -> ByClawCallbackContext:
    return ByClawCallbackContext(
        user_code=str(headers.get(USER_CODE_HEADER) or "").strip(),
        chat_session_id=str(headers.get(CHAT_SESSION_ID_HEADER) or "").strip(),
        resource_id=str(headers.get(RESOURCE_ID_HEADER) or "").strip(),
    )


def _json_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return dict(value) if isinstance(value, Mapping) else {}


def _context_from_extra_params(value: Any) -> ByClawCallbackContext:
    context = _json_mapping(value).get(CALLBACK_CONTEXT_EXTRA_PARAM)
    if not isinstance(context, Mapping):
        return ByClawCallbackContext()
    return ByClawCallbackContext(
        user_code=str(context.get("userCode") or "").strip(),
        chat_session_id=str(context.get("chatSessionId") or "").strip(),
        resource_id=str(context.get("resourceId") or "").strip(),
    )


async def _resolve_batch_context_from_db(
    batch_id: str,
    knowledge_base_id: str,
) -> Mapping[str, Any]:
    connection = await build_connection_factory(get_settings())()
    try:
        row = await KnowledgeSemanticProcessingBatchRepository().get_batch(
            connection.cursor(),
            batch_id=batch_id,
            knowledge_base_id=int(knowledge_base_id),
        )
    finally:
        await connection.close()
    return _json_mapping((row or {}).get("extra_params"))


async def _resolve_knowledge_base_from_db(kb_code: str) -> Mapping[str, Any]:
    connection = await build_connection_factory(get_settings())()
    try:
        row = await KnowledgeBaseRepository().get_by_code(connection.cursor(), kb_code)
    finally:
        await connection.close()
    return row or {}


async def _resolve_beyond_token_from_redis(user_code: str) -> str:
    redis_client = init_shared_redis_from_env()
    user_id = await _await_if_needed(
        redis_client.get(f"SHARE_BFM_USER_CODE_{user_code}")
    )
    normalized_user_id = _redis_string(user_id)
    if not normalized_user_id:
        raise ByClawKnowledgeEventPublisherError(
            "Redis user mapping is missing for X-User-Code"
        )
    token = await _await_if_needed(
        redis_client.hget(
            f"user:{normalized_user_id}:login:auth",
            "Beyond-Token",
        )
    )
    normalized_token = _redis_string(token)
    if not normalized_token:
        raise ByClawKnowledgeEventPublisherError(
            "Redis login state is missing Beyond-Token"
        )
    return normalized_token


def _build_object_files(
    event: KnowledgeEvent,
    *,
    context: ByClawCallbackContext,
    metadata: Mapping[str, str],
) -> list[dict[str, Any]]:
    if isinstance(event, DiscoveryFileCompletedEvent | EnrichFileCompletedEvent):
        files = _semantic_entity_files(event, context=context, metadata=metadata)
        files.append(
            _object_file(
                event=event,
                file_path=event.payload.file_path,
                status=_semantic_status(event),
                context=context,
                metadata=metadata,
                kb_id=event.payload.knowledge_base_id,
            )
        )
        return files
    if isinstance(event, BuildFileCompletedEvent):
        status = {
            "complete": "已完成",
            "failed": "构建失败-待重试",
            "unsupported": "不支持构建",
        }[event.payload.status]
        return [
            _object_file(
                event=event,
                file_path=event.payload.file_path,
                status=status,
                context=context,
                metadata=metadata,
            )
        ]

    paths: list[tuple[str, str]] = []
    if isinstance(event, DirectoryCreatedEvent):
        paths = [(event.payload.target_path, "已完成")]
    elif isinstance(event, DirectoryUpdatedEvent):
        paths = [(event.payload.target_path, "已完成")]
    elif isinstance(event, DirectoryDeletedEvent):
        paths = [(event.payload.source_path, "已删除")]
    elif isinstance(event, FileImportedEvent):
        paths = [
            (item.target_path, "待构建")
            for item in event.payload.items
            if item.success and item.target_path
        ]
        if not paths and event.payload.result.succeeded:
            paths = [(event.payload.target_path, "待构建")]
    elif isinstance(event, FileUpdatedEvent):
        if event.payload.result.success:
            paths = [(event.payload.target_path, "待构建")]
    elif isinstance(event, FileDeletedEvent):
        paths = [(event.payload.source_path, "已删除")]
    elif isinstance(event, ResourceMovedEvent):
        paths = [
            (item.target_path, "已完成")
            for item in event.payload.items
            if item.success and item.target_path
        ]
    return [
        _object_file(
            event=event,
            file_path=path,
            status=status,
            context=context,
            metadata=metadata,
        )
        for path, status in _deduplicate_paths(paths)
    ]


def _semantic_status(
    event: DiscoveryFileCompletedEvent | EnrichFileCompletedEvent,
) -> str:
    if event.payload.status == "SUCCEEDED":
        return "已完成"
    if isinstance(event, DiscoveryFileCompletedEvent):
        return "待发现" if event.payload.status == "SKIPPED" else "发现失败-待重试"
    return "待整理" if event.payload.status == "SKIPPED" else "整理失败-待重试"


def _semantic_entity_files(
    event: DiscoveryFileCompletedEvent | EnrichFileCompletedEvent,
    *,
    context: ByClawCallbackContext,
    metadata: Mapping[str, str],
) -> list[dict[str, Any]]:
    if (
        not isinstance(event, DiscoveryFileCompletedEvent)
        or event.payload.status != "SUCCEEDED"
        or not isinstance(event.payload.result, Mapping)
    ):
        return []
    actions = event.payload.result.get("actions")
    if not isinstance(actions, list):
        return []
    paths = []
    for action in actions:
        if not isinstance(action, Mapping):
            continue
        if str(action.get("action") or "").upper() not in {"CREATED", "ANCHORED"}:
            continue
        path = str(action.get("filePath") or "").strip()
        if path:
            paths.append((path, "待整理"))
    return [
        _object_file(
            event=event,
            file_path=path,
            status=status,
            context=context,
            metadata=metadata,
            kb_id=event.payload.knowledge_base_id,
        )
        for path, status in _deduplicate_paths(paths)
    ]


def _deduplicate_paths(paths: list[tuple[str, str]]) -> list[tuple[str, str]]:
    result = []
    seen = set()
    for path, status in paths:
        normalized = str(path or "").strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append((normalized, status))
    return result


def _object_file(
    *,
    event: KnowledgeEvent,
    file_path: str,
    status: str,
    context: ByClawCallbackContext,
    metadata: Mapping[str, str],
    kb_id: str | None = None,
) -> dict[str, Any]:
    path = PurePosixPath(file_path)
    return {
        "sessionId": context.chat_session_id,
        "objectType": "knowledge",
        "objectName": metadata["name"],
        "objectCode": event.kb_code,
        "fileName": path.name,
        "filePath": file_path,
        "version": "1",
        "statusCd": status,
        "extContent": json.dumps(
            {
                "kb_resource_id": context.resource_id,
                "kb_id": kb_id or metadata["id"],
                "kb_directory": str(path.parent),
            },
            ensure_ascii=False,
        ),
    }


async def _await_if_needed(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _redis_string(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8").strip()
    return str(value or "").strip()


def _build_discovered_url(instance: Any, path: str) -> str:
    protocol = str(getattr(instance, "protocol", "") or "http").strip() or "http"
    segments = []
    path_prefix = str(getattr(instance, "path_prefix", "") or "").strip("/")
    if path_prefix:
        segments.append(path_prefix)
    request_path = path.strip("/")
    if request_path:
        segments.append(request_path)
    suffix = "/".join(segments)
    base = f"{protocol}://{instance.host}:{instance.port}"
    return f"{base}/{suffix}" if suffix else base


def _validate_response(raw: Any) -> None:
    if not isinstance(raw, Mapping):
        raise ByClawKnowledgeEventPublisherError(
            "saveOrUpdateObjectFiles response must be an object"
        )
    code = raw.get("code", raw.get("resultCode", 0))
    if str(code) not in {"0", "200"}:
        message = raw.get("msg") or raw.get("resultMsg") or raw
        raise ByClawKnowledgeEventPublisherError(str(message))


__all__ = [
    "CALLBACK_CONTEXT_EXTRA_PARAM",
    "EVENT_PUBLISHER_PROVIDER_PATH",
    "SAVE_OR_UPDATE_OBJECT_FILES_PATH",
    "ByClawCallbackContext",
    "ByClawKnowledgeEventPublisher",
    "ByClawKnowledgeEventPublisherError",
    "build_byclaw_knowledge_event_publisher",
]
