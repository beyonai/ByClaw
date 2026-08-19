"""Restore durable ByClaw auth context for KnowledgeEntity worker tasks."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from by_qa.knowledge_base.services.knowledge_entity_background_runner import (
    KnowledgeEntityBackgroundRunner,
)
from by_qa.knowledge_base.services.knowledge_entity_callback import json_mapping

from byclaw_knowledge_entity_callback import CALLBACK_CONTEXT_EXTRA_PARAM
from byclaw_userfs_storage import (
    RESOURCE_ID_HEADER,
    USER_CODE_HEADER,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)


class ByClawKnowledgeEntityBackgroundRunner(KnowledgeEntityBackgroundRunner):
    """Bind persisted request identity while one claimed task is executing."""

    async def _execute_claimed(self, row: Mapping[str, Any]) -> None:
        context_token = set_byclaw_userfs_headers(_task_storage_headers(row))
        try:
            await super()._execute_claimed(row)
        finally:
            reset_byclaw_userfs_headers(context_token)


def _task_storage_headers(row: Mapping[str, Any]) -> dict[str, str]:
    extra_params = json_mapping(row.get("extra_params")) or {}
    callback_context = extra_params.get(CALLBACK_CONTEXT_EXTRA_PARAM)
    if not isinstance(callback_context, Mapping):
        return {}
    user_code = str(callback_context.get("userCode") or "").strip()
    resource_id = str(callback_context.get("resourceId") or "").strip()
    headers = {}
    if user_code:
        headers[USER_CODE_HEADER] = user_code
    if resource_id:
        headers[RESOURCE_ID_HEADER] = resource_id
    return headers


def install_byclaw_knowledge_entity_runner() -> None:
    """Install the auth-aware runner before by-qa builds its lazy runtime."""
    from by_qa.knowledge_base.infrastructure import runtime

    runtime.KnowledgeEntityBackgroundRunner = ByClawKnowledgeEntityBackgroundRunner


__all__ = [
    "ByClawKnowledgeEntityBackgroundRunner",
    "install_byclaw_knowledge_entity_runner",
]
