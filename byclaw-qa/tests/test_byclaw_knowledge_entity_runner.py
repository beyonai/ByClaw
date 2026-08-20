from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from by_qa.knowledge_base.infrastructure.storage import StorageLocation

from byclaw_knowledge_entity_callback import CALLBACK_CONTEXT_EXTRA_PARAM
from byclaw_knowledge_entity_runner import (
    ByClawKnowledgeEntityBackgroundRunner,
    install_byclaw_knowledge_entity_runner,
)
from byclaw_knowledge_storage import ByClawKnowledgeStorageProvider


class FakeTransport:
    def __init__(self):
        self.calls = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return {"status_code": 200, "content": b"markdown"}


@pytest.mark.asyncio
async def test_runner_restores_user_code_and_resource_id_for_worker_storage_read(
    monkeypatch,
):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    redis_client = MagicMock()
    redis_client.get = AsyncMock(return_value=b"real-user-1")
    redis_client.hget = AsyncMock(return_value=b"token-from-redis")
    monkeypatch.setattr(
        "redis_runtime.init_shared_redis_from_env",
        lambda: redis_client,
    )
    transport = FakeTransport()
    storage = ByClawKnowledgeStorageProvider(transport=transport)
    worker = MagicMock()

    async def run_task(_context):
        content = await storage.read(
            StorageLocation(
                "BYCLAW-USER",
                "/.bykc/168/raw/markdown/OriginalDocument/source.md.md",
            )
        )
        assert content == b"markdown"
        return {"result_payload": {}, "index_version": None}

    worker.run_task = run_task
    runner = ByClawKnowledgeEntityBackgroundRunner(
        connection_factory=MagicMock(),
        task_repository=MagicMock(),
        batch_repository=MagicMock(),
        worker=worker,
        callback_invoker=MagicMock(),
        worker_id="worker-1",
    )
    row = {
        "kid": 1,
        "lease_token": "lease-1",
        "task_type": "ENTITY_DISCOVERY",
        "knowledge_base_id": 168,
        "fs_entry_id": 10,
        "file_path_snapshot": "/OriginalDocument/source.md",
        "request_params": {},
        "batch_id": "batch-1",
        "extra_params": {
            CALLBACK_CONTEXT_EXTRA_PARAM: {
                "userCode": "operator-1",
                "chatSessionId": "session-1",
                "resourceId": "42",
            }
        },
    }

    with patch.object(
        ByClawKnowledgeEntityBackgroundRunner,
        "_finish_claimed",
        new_callable=AsyncMock,
    ) as finish_claimed:
        await runner._execute_claimed(row)

    assert transport.calls[0]["headers"] == {
        "system-code": "BYCLAW-QA",
        "beyond-token": "token-from-redis",
    }
    assert transport.calls[0]["params"] == {
        "spaceType": "RESOURCE",
        "resourceId": "42",
        "path": (
            "/resource/kg_doc/KG_DOC_42"
            "/.bykc/168/raw/markdown/OriginalDocument/source.md.md"
        ),
    }
    redis_client.get.assert_awaited_once_with("SHARE_BFM_USER_CODE_operator-1")
    finish_claimed.assert_awaited_once()
    assert finish_claimed.call_args.kwargs["status"] == "succeeded"


def test_install_replaces_byqa_runtime_runner():
    from by_qa.knowledge_base.infrastructure import runtime

    install_byclaw_knowledge_entity_runner()

    assert (
        runtime.KnowledgeEntityBackgroundRunner is ByClawKnowledgeEntityBackgroundRunner
    )
