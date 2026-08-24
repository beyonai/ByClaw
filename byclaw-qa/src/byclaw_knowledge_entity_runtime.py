"""Persist and restore ByClaw identity for durable KnowledgeEntity tasks."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from by_qa.knowledge_base.repositories.knowledge_semantic_processing_batch_repository import (
    KnowledgeSemanticProcessingBatchRepository,
)
from by_qa.knowledge_base.repositories.knowledge_semantic_processing_task_repository import (
    KnowledgeSemanticProcessingTaskRepository,
)
from by_qa.knowledge_base.services.knowledge_entity_background_runner import (
    KnowledgeEntityBackgroundRunner,
)

from byclaw_knowledge_event_publisher import CALLBACK_CONTEXT_EXTRA_PARAM
from byclaw_userfs_storage import (
    CHAT_SESSION_ID_HEADER,
    RESOURCE_ID_HEADER,
    USER_CODE_HEADER,
    get_byclaw_userfs_header_context,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)

BYCLAW_RUNTIME_CONTEXT_PARAM = CALLBACK_CONTEXT_EXTRA_PARAM


def _runtime_context() -> dict[str, str]:
    headers = get_byclaw_userfs_header_context()
    return {
        "userCode": str(headers.get(USER_CODE_HEADER) or "").strip(),
        "chatSessionId": str(headers.get(CHAT_SESSION_ID_HEADER) or "").strip(),
        "resourceId": str(headers.get(RESOURCE_ID_HEADER) or "").strip(),
    }


def _with_runtime_context(value: Mapping[str, Any] | None) -> dict[str, Any]:
    extra_params = dict(value or {})
    context = _runtime_context()
    if context["userCode"]:
        extra_params[BYCLAW_RUNTIME_CONTEXT_PARAM] = context
    else:
        extra_params.pop(BYCLAW_RUNTIME_CONTEXT_PARAM, None)
    return extra_params


def _context_headers(row: Mapping[str, Any]) -> dict[str, str]:
    extra_params = row.get("extra_params")
    if not isinstance(extra_params, Mapping):
        return {}
    context = extra_params.get(BYCLAW_RUNTIME_CONTEXT_PARAM)
    if not isinstance(context, Mapping):
        return {}
    return {
        USER_CODE_HEADER: str(context.get("userCode") or "").strip(),
        CHAT_SESSION_ID_HEADER: str(context.get("chatSessionId") or "").strip(),
        RESOURCE_ID_HEADER: str(context.get("resourceId") or "").strip(),
    }


class ByClawKnowledgeSemanticProcessingBatchRepository(
    KnowledgeSemanticProcessingBatchRepository
):
    async def create_batch(self, cursor: Any, **kwargs: Any):
        kwargs["extra_params"] = _with_runtime_context(kwargs.get("extra_params"))
        return await super().create_batch(cursor, **kwargs)


class ByClawKnowledgeSemanticProcessingTaskRepository(
    KnowledgeSemanticProcessingTaskRepository
):
    async def create_processing_task(self, cursor: Any, **kwargs: Any):
        kwargs["extra_params"] = _with_runtime_context(kwargs.get("extra_params"))
        return await super().create_processing_task(cursor, **kwargs)


class ByClawKnowledgeEntityBackgroundRunner(KnowledgeEntityBackgroundRunner):
    """Restore persisted request identity while executing a claimed task."""

    async def _execute_claimed(self, row: Mapping[str, Any]) -> None:
        context_token = set_byclaw_userfs_headers(_context_headers(row))
        try:
            await super()._execute_claimed(row)
        finally:
            reset_byclaw_userfs_headers(context_token)


def install_byclaw_knowledge_entity_runtime() -> None:
    """Install durable-context adapters before by-qa builds its lazy runtime."""
    from by_qa.knowledge_base.infrastructure import runtime

    runtime.KnowledgeSemanticProcessingBatchRepository = (
        ByClawKnowledgeSemanticProcessingBatchRepository
    )
    runtime.KnowledgeSemanticProcessingTaskRepository = (
        ByClawKnowledgeSemanticProcessingTaskRepository
    )
    runtime.KnowledgeEntityBackgroundRunner = ByClawKnowledgeEntityBackgroundRunner


__all__ = [
    "BYCLAW_RUNTIME_CONTEXT_PARAM",
    "ByClawKnowledgeEntityBackgroundRunner",
    "ByClawKnowledgeSemanticProcessingBatchRepository",
    "ByClawKnowledgeSemanticProcessingTaskRepository",
    "install_byclaw_knowledge_entity_runtime",
]
