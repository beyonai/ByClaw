"""ByClaw callback adapter for terminal KnowledgeEntity processing events."""

from __future__ import annotations

import inspect
import json
import os
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

import httpx

from by_framework.core.discovery import DiscoveryClient
from by_qa.config import get_settings
from by_qa.core import logger
from by_qa.knowledge_base.api.knowledge_entity_schemas import (
    ProcessingTaskStatus,
    ProcessingTaskType,
)
from by_qa.knowledge_base.infrastructure.database import build_connection_factory
from by_qa.knowledge_base.repositories.knowledge_base_repository import (
    KnowledgeBaseRepository,
)
from by_qa.knowledge_base.services.knowledge_entity_callback import (
    BatchCompletedCallbackInput,
    FileCompletedCallbackInput,
)

from redis_runtime import init_shared_redis_from_env


SAVE_OR_UPDATE_OBJECT_FILES_PATH = (
    "/byaiService/devloop/operation/saveOrUpdateObjectFiles"
)
DINGTALK_TEST_SEND_PATH = "/byaiService/open/api/v1/dingtalk/testSend"
CALLBACK_CONTEXT_EXTRA_PARAM = "_byclawCallbackContext"
CALLBACK_PROVIDER_PATH = (
    "byclaw_knowledge_entity_callback:build_byclaw_knowledge_entity_callback"
)
_TIMEOUT_SECONDS = 30.0

os.environ.setdefault("KNOWLEDGE_ENTITY_CALLBACK_PROVIDER", CALLBACK_PROVIDER_PATH)

PostJson = Callable[
    [str, dict[str, Any], dict[str, str]],
    Mapping[str, Any] | Awaitable[Mapping[str, Any]],
]
GetJson = Callable[
    [str, dict[str, str], dict[str, str]],
    Mapping[str, Any] | Awaitable[Mapping[str, Any]],
]
BeyondTokenResolver = Callable[[str], str | Awaitable[str]]
UserIdResolver = Callable[[str], str | Awaitable[str]]
KnowledgeBaseNameResolver = Callable[[str], str | Awaitable[str]]


@dataclass(frozen=True, slots=True)
class _ProcessingProfile:
    success_status: str
    failed_status: str
    skipped_status: str


_PROCESSING_PROFILES = {
    ProcessingTaskType.ENTITY_DISCOVERY: _ProcessingProfile(
        success_status="已完成",
        failed_status="发现失败-待重试",
        skipped_status="待发现",
    ),
    ProcessingTaskType.DOCUMENT_ENRICH: _ProcessingProfile(
        success_status="已完成",
        failed_status="整理失败-待重试",
        skipped_status="待整理",
    ),
}


class ByClawKnowledgeEntityCallbackError(RuntimeError):
    """Raised when delivery to the knowledge-file callback fails."""


@dataclass(slots=True)
class ByClawKnowledgeEntityProcessingCallback:
    """Report file terminal states and notify users when a batch completes."""

    post_json: PostJson | None = None
    get_json: GetJson | None = None
    beyond_token_resolver: BeyondTokenResolver | None = None
    user_id_resolver: UserIdResolver | None = None
    knowledge_base_name_resolver: KnowledgeBaseNameResolver | None = None

    async def on_file_completed(self, event: FileCompletedCallbackInput) -> None:
        started_at = time.perf_counter()
        user_code, chat_session_id, resource_id = _callback_context(
            event.extra_params
        )
        logger.info(
            "byclaw knowledge_entity callback received: callback_method=on_file_completed "
            "batch_id=%s task_id=%s batch_version=%s task_type=%s status=%s",
            event.batch_id,
            event.task_id,
            event.progress.version,
            event.task_type.value,
            event.status.value,
        )
        if not user_code or not chat_session_id:
            logger.info(
                "byclaw knowledge_entity callback skipped: "
                "callback_method=on_file_completed batch_id=%s task_id=%s "
                "batch_version=%s invoke_result=skipped_missing_headers "
                "has_user_code=%s has_chat_session_id=%s",
                event.batch_id,
                event.task_id,
                event.progress.version,
                bool(user_code),
                bool(chat_session_id),
            )
            return

        try:
            knowledge_base_name = await self._resolve_knowledge_base_name(event.kb_code)
            discovered_entity_files = _build_discovered_entity_files(
                event,
                chat_session_id=chat_session_id,
                knowledge_base_name=knowledge_base_name,
                resource_id=resource_id,
            )
            payload = {
                "objectFiles": [
                    *discovered_entity_files,
                    _build_knowledge_file(
                        event,
                        chat_session_id=chat_session_id,
                        knowledge_base_name=knowledge_base_name,
                        resource_id=resource_id,
                    )
                ]
            }
            beyond_token = await self._resolve_beyond_token(user_code)
            headers = {
                "Content-Type": "application/json",
                "Beyond-Token": beyond_token,
                "X-User-Code": user_code,
                "X-CHAT-SESSION-ID": chat_session_id,
            }
            if self.post_json is None:
                raw = await self._post_by_discovery(
                    payload=payload,
                    headers=headers,
                )
            else:
                response = self.post_json(
                    SAVE_OR_UPDATE_OBJECT_FILES_PATH,
                    payload,
                    headers,
                )
                raw = await response if inspect.isawaitable(response) else response
            _validate_response(raw)
        except Exception:
            logger.exception(
                "byclaw knowledge_entity callback failed: "
                "callback_method=on_file_completed batch_id=%s task_id=%s "
                "batch_version=%s invoke_result=failed elapsed_ms=%.2f",
                event.batch_id,
                event.task_id,
                event.progress.version,
                (time.perf_counter() - started_at) * 1000,
            )
            raise

        logger.info(
            "byclaw knowledge_entity callback completed: "
            "callback_method=on_file_completed batch_id=%s task_id=%s "
            "batch_version=%s invoke_result=success "
            "discovered_entity_file_count=%s elapsed_ms=%.2f",
            event.batch_id,
            event.task_id,
            event.progress.version,
            len(discovered_entity_files),
            (time.perf_counter() - started_at) * 1000,
        )

    async def _resolve_beyond_token(self, user_code: str) -> str:
        if self.beyond_token_resolver is None:
            return await _resolve_beyond_token_from_redis(user_code)
        token_result = self.beyond_token_resolver(user_code)
        token = (
            await token_result if inspect.isawaitable(token_result) else token_result
        )
        normalized = str(token or "").strip()
        if not normalized:
            raise ByClawKnowledgeEntityCallbackError(
                "Redis login state is missing Beyond-Token"
            )
        return normalized

    async def _resolve_user_id(self, user_code: str) -> str:
        if self.user_id_resolver is None:
            return await _resolve_user_id_from_redis(user_code)
        user_id_result = self.user_id_resolver(user_code)
        user_id = (
            await user_id_result
            if inspect.isawaitable(user_id_result)
            else user_id_result
        )
        normalized = str(user_id or "").strip()
        if not normalized:
            raise ByClawKnowledgeEntityCallbackError(
                "Redis user mapping is missing for X-User-Code"
            )
        return normalized

    async def _resolve_knowledge_base_name(self, kb_code: str) -> str:
        if self.knowledge_base_name_resolver is None:
            return await _resolve_knowledge_base_name_from_db(kb_code)
        name_result = self.knowledge_base_name_resolver(kb_code)
        name = await name_result if inspect.isawaitable(name_result) else name_result
        normalized = str(name or "").strip()
        if not normalized:
            raise ByClawKnowledgeEntityCallbackError(
                f"Knowledge base name is missing for code: {kb_code}"
            )
        return normalized

    async def on_batch_completed(self, event: BatchCompletedCallbackInput) -> None:
        started_at = time.perf_counter()
        user_code, _, resource_id = _callback_context(event.extra_params)
        if not user_code:
            logger.info(
                "byclaw knowledge_entity callback skipped: "
                "callback_method=on_batch_completed batch_id=%s "
                "batch_version=%s invoke_result=skipped_missing_user_code",
                event.batch_id,
                event.progress.version,
            )
            return

        try:
            user_id = await self._resolve_user_id(user_code)
            beyond_token = await self._resolve_beyond_token(user_code)
            params = {
                "senderUserId": user_id,
                "receiverUserId": user_id,
                "content": _build_batch_notification(
                    event,
                    resource_id=resource_id,
                ),
            }
            headers = {"Beyond-Token": beyond_token}
            if self.get_json is None:
                raw = await self._get_by_discovery(params=params, headers=headers)
            else:
                response = self.get_json(DINGTALK_TEST_SEND_PATH, params, headers)
                raw = await response if inspect.isawaitable(response) else response
            _validate_response(raw)
        except Exception:
            logger.exception(
                "byclaw knowledge_entity callback failed: "
                "callback_method=on_batch_completed batch_id=%s "
                "batch_version=%s invoke_result=failed elapsed_ms=%.2f",
                event.batch_id,
                event.progress.version,
                (time.perf_counter() - started_at) * 1000,
            )
            raise

        logger.info(
            "byclaw knowledge_entity callback completed: "
            "callback_method=on_batch_completed batch_id=%s batch_version=%s "
            "task_type=%s completed_count=%s total_count=%s "
            "invoke_result=success elapsed_ms=%.2f",
            event.batch_id,
            event.progress.version,
            event.task_type.value,
            event.progress.completed_count,
            event.progress.total_count,
            (time.perf_counter() - started_at) * 1000,
        )

    async def _get_by_discovery(
        self,
        *,
        params: dict[str, str],
        headers: dict[str, str],
    ) -> Mapping[str, Any]:
        service_name = os.getenv("BE_DOMAINNAME", "ByaiService").strip()
        redis_client = init_shared_redis_from_env()
        discovery_client = DiscoveryClient(
            redis_client=redis_client,
            cache_interval=5,
        )
        try:
            instance = await discovery_client.discover(
                service_name,
                health_threshold_ms=-1,
            )
            if not instance:
                raise ByClawKnowledgeEntityCallbackError(
                    f"No available instances for service: {service_name}"
                )
            url = _build_discovered_url(instance, DINGTALK_TEST_SEND_PATH)
            async with httpx.AsyncClient(
                timeout=_TIMEOUT_SECONDS,
                headers=headers,
            ) as client:
                response = await client.get(url, params=params)
                try:
                    raw = response.json()
                except ValueError as exc:
                    raise ByClawKnowledgeEntityCallbackError(
                        "testSend response must be JSON"
                    ) from exc
                if not response.is_success:
                    raise ByClawKnowledgeEntityCallbackError(
                        f"testSend returned HTTP {response.status_code}: {raw}"
                    )
                if not isinstance(raw, Mapping):
                    raise ByClawKnowledgeEntityCallbackError(
                        "testSend response must be an object"
                    )
                return raw
        except httpx.HTTPError as exc:
            raise ByClawKnowledgeEntityCallbackError(
                f"testSend HTTP error: {exc}"
            ) from exc
        finally:
            await discovery_client.close()

    async def _post_by_discovery(
        self,
        *,
        payload: dict[str, Any],
        headers: dict[str, str],
    ) -> Mapping[str, Any]:
        service_name = os.getenv("BE_DOMAINNAME", "ByaiService").strip()
        redis_client = init_shared_redis_from_env()
        discovery_client = DiscoveryClient(
            redis_client=redis_client,
            cache_interval=5,
        )
        try:
            instance = await discovery_client.discover(
                service_name,
                health_threshold_ms=-1,
            )
            if not instance:
                raise ByClawKnowledgeEntityCallbackError(
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
                    raise ByClawKnowledgeEntityCallbackError(
                        "saveOrUpdateObjectFiles response must be JSON"
                    ) from exc
                if not response.is_success:
                    raise ByClawKnowledgeEntityCallbackError(
                        "saveOrUpdateObjectFiles returned HTTP "
                        f"{response.status_code}: {raw}"
                    )
                if not isinstance(raw, Mapping):
                    raise ByClawKnowledgeEntityCallbackError(
                        "saveOrUpdateObjectFiles response must be an object"
                    )
                return raw
        except httpx.HTTPError as exc:
            raise ByClawKnowledgeEntityCallbackError(
                f"saveOrUpdateObjectFiles HTTP error: {exc}"
            ) from exc
        finally:
            await discovery_client.close()


def build_byclaw_knowledge_entity_callback() -> ByClawKnowledgeEntityProcessingCallback:
    """Build the callback provider loaded by by-qa's provider hook."""
    return ByClawKnowledgeEntityProcessingCallback()


def _callback_context(extra_params: Mapping[str, Any]) -> tuple[str, str, str]:
    context = extra_params.get(CALLBACK_CONTEXT_EXTRA_PARAM)
    if not isinstance(context, Mapping):
        return "", "", ""
    return (
        str(context.get("userCode") or "").strip(),
        str(context.get("chatSessionId") or "").strip(),
        str(context.get("resourceId") or "").strip(),
    )


async def _resolve_beyond_token_from_redis(user_code: str) -> str:
    redis_client = init_shared_redis_from_env()
    normalized_user_id = await _resolve_user_id_from_redis(
        user_code,
        redis_client=redis_client,
    )
    token = await _await_if_needed(
        redis_client.hget(
            f"user:{normalized_user_id}:login:auth",
            "Beyond-Token",
        )
    )
    normalized_token = _redis_string(token)
    if not normalized_token:
        raise ByClawKnowledgeEntityCallbackError(
            "Redis login state is missing Beyond-Token"
        )
    return normalized_token


async def _resolve_user_id_from_redis(
    user_code: str,
    *,
    redis_client: Any | None = None,
) -> str:
    client = redis_client or init_shared_redis_from_env()
    user_id = await _await_if_needed(
        client.get(f"SHARE_BFM_USER_CODE_{user_code}")
    )
    normalized_user_id = _redis_string(user_id)
    if not normalized_user_id:
        raise ByClawKnowledgeEntityCallbackError(
            "Redis user mapping is missing for X-User-Code"
        )
    return normalized_user_id


async def _resolve_knowledge_base_name_from_db(kb_code: str) -> str:
    connection = await build_connection_factory(get_settings())()
    try:
        row = await KnowledgeBaseRepository().get_by_code(
            connection.cursor(),
            kb_code,
        )
    finally:
        await connection.close()
    name = str((row or {}).get("kb_name") or "").strip()
    if not name:
        raise ByClawKnowledgeEntityCallbackError(
            f"Knowledge base name is missing for code: {kb_code}"
        )
    return name


async def _await_if_needed(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _redis_string(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8").strip()
    return str(value or "").strip()


def _build_batch_notification(
    event: BatchCompletedCallbackInput,
    *,
    resource_id: str,
) -> str:
    task_name = {
        ProcessingTaskType.ENTITY_DISCOVERY: "知识实体发现",
        ProcessingTaskType.DOCUMENT_ENRICH: "知识实体整理",
    }[event.task_type]
    progress = event.progress
    if progress.failed_count:
        conclusion = "任务已完成，部分文件处理失败"
    elif progress.skipped_count:
        conclusion = "任务已完成，部分文件已跳过"
    else:
        conclusion = "任务已全部成功完成"
    return "\n".join(
        (
            f"【{task_name}】{conclusion}",
            f"知识库资源 ID：{resource_id or '未提供'}",
            f"批次：{event.batch_id}",
            f"总计：{progress.total_count} 个文件",
            f"成功：{progress.succeeded_count} 个",
            f"失败：{progress.failed_count} 个",
            f"跳过：{progress.skipped_count} 个",
        )
    )


def _build_knowledge_file(
    event: FileCompletedCallbackInput,
    *,
    chat_session_id: str,
    knowledge_base_name: str,
    resource_id: str,
) -> dict[str, Any]:
    profile = _PROCESSING_PROFILES[event.task_type]
    status = _object_status(profile, event.status)
    file_path = PurePosixPath(event.file_path)
    return {
        "sessionId": chat_session_id,
        "objectType": "knowledge",
        "objectName": knowledge_base_name,
        "objectCode": event.kb_code,
        "fileName": file_path.name,
        "filePath": event.file_path,
        "version": "1",
        "statusCd": status,
        "extContent": json.dumps(
            {
                "kb_resource_id": resource_id,
                "kb_id": event.knowledge_base_id,
                "kb_directory": str(file_path.parent),
            },
            ensure_ascii=False,
        ),
    }


def _build_discovered_entity_files(
    event: FileCompletedCallbackInput,
    *,
    chat_session_id: str,
    knowledge_base_name: str,
    resource_id: str,
) -> list[dict[str, Any]]:
    if (
        event.task_type != ProcessingTaskType.ENTITY_DISCOVERY
        or event.status != ProcessingTaskStatus.SUCCEEDED
        or not isinstance(event.result, Mapping)
    ):
        return []
    actions = event.result.get("actions")
    if not isinstance(actions, list):
        return []

    object_files: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for action in actions:
        if not isinstance(action, Mapping):
            continue
        action_name = str(action.get("action") or "").strip().upper()
        if action_name not in {"CREATED", "ANCHORED"}:
            continue
        file_path_value = str(action.get("filePath") or "").strip()
        if not file_path_value or file_path_value in seen_paths:
            continue
        seen_paths.add(file_path_value)
        file_path = PurePosixPath(file_path_value)
        object_files.append(
            {
                "sessionId": chat_session_id,
                "objectType": "knowledge",
                "objectName": knowledge_base_name,
                "objectCode": event.kb_code,
                "fileName": file_path.name,
                "filePath": file_path_value,
                "version": "1",
                "statusCd": "待整理",
                "extContent": json.dumps(
                    {
                        "kb_resource_id": resource_id,
                        "kb_id": event.knowledge_base_id,
                        "kb_directory": str(file_path.parent),
                    },
                    ensure_ascii=False,
                ),
            }
        )
    return object_files


def _object_status(
    profile: _ProcessingProfile,
    status: ProcessingTaskStatus,
) -> str:
    if status == ProcessingTaskStatus.SUCCEEDED:
        return profile.success_status
    if status == ProcessingTaskStatus.SKIPPED:
        return profile.skipped_status
    return profile.failed_status


def _build_discovered_url(instance: Any, path: str) -> str:
    protocol = str(getattr(instance, "protocol", "") or "http").strip() or "http"
    segments: list[str] = []
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
        raise ByClawKnowledgeEntityCallbackError(
            "saveOrUpdateObjectFiles response must be an object"
        )
    code = raw.get("code", raw.get("resultCode", 0))
    if str(code) not in {"0", "200"}:
        message = raw.get("msg") or raw.get("resultMsg") or raw
        raise ByClawKnowledgeEntityCallbackError(str(message))
