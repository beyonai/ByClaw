from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from by_qa.knowledge_base.infrastructure.storage import StorageLocation

from byclaw_knowledge_entity_runtime import (
    BYCLAW_RUNTIME_CONTEXT_PARAM,
    ByClawKnowledgeEntityBackgroundRunner,
    ByClawKnowledgeSemanticProcessingBatchRepository,
    ByClawKnowledgeSemanticProcessingTaskRepository,
    install_byclaw_knowledge_entity_runtime,
)
from byclaw_knowledge_storage import ByClawKnowledgeStorageProvider
from byclaw_userfs_storage import (
    CHAT_SESSION_ID_HEADER,
    RESOURCE_ID_HEADER,
    USER_CODE_HEADER,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)


class FakeTransport:
    def __init__(self):
        self.calls = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return {"status_code": 200, "content": b"markdown"}


def test_install_replaces_all_byqa_durable_runtime_components():
    from by_qa.knowledge_base.infrastructure import runtime

    install_byclaw_knowledge_entity_runtime()

    assert (
        runtime.KnowledgeSemanticProcessingBatchRepository
        is ByClawKnowledgeSemanticProcessingBatchRepository
    )
    assert (
        runtime.KnowledgeSemanticProcessingTaskRepository
        is ByClawKnowledgeSemanticProcessingTaskRepository
    )
    assert (
        runtime.KnowledgeEntityBackgroundRunner
        is ByClawKnowledgeEntityBackgroundRunner
    )


@pytest.mark.asyncio
async def test_task_and_batch_repositories_persist_server_owned_context():
    cursor = MagicMock()
    cursor.execute = AsyncMock()
    cursor.fetchone = AsyncMock(return_value={"kid": 1})
    context_token = set_byclaw_userfs_headers(
        {
            USER_CODE_HEADER: "operator-1",
            CHAT_SESSION_ID_HEADER: "session-1",
            RESOURCE_ID_HEADER: "42",
        }
    )
    try:
        await ByClawKnowledgeSemanticProcessingBatchRepository().create_batch(
            cursor,
            batch_id="batch-1",
            knowledge_base_id=193,
            task_type="ENTITY_DISCOVERY",
            scope="FILE",
            total_count=1,
        )
        batch_params = cursor.execute.await_args.args[1]
        await ByClawKnowledgeSemanticProcessingTaskRepository().create_processing_task(
            cursor,
            knowledge_base_id=193,
            fs_entry_id=1327,
            task_type="ENTITY_DISCOVERY",
            batch_id="batch-1",
            file_path_snapshot="/demo2.md",
        )
        task_params = cursor.execute.await_args.args[1]
    finally:
        reset_byclaw_userfs_headers(context_token)

    expected = {
        "userCode": "operator-1",
        "chatSessionId": "session-1",
        "resourceId": "42",
    }
    assert json.loads(batch_params["extra_params"])[
        BYCLAW_RUNTIME_CONTEXT_PARAM
    ] == expected
    assert json.loads(task_params["extra_params"])[
        BYCLAW_RUNTIME_CONTEXT_PARAM
    ] == expected


@pytest.mark.asyncio
async def test_worker_restores_durable_userfs_context_before_reading_markdown(
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
        return {
            "result_payload": await storage.read(
                StorageLocation(
                    "BYCLAW-USER",
                    "/.bykc/193/raw/markdown/demo2.md.md",
                )
            ),
            "index_version": None,
        }

    worker.run_task = run_task
    runner = ByClawKnowledgeEntityBackgroundRunner(
        connection_factory=MagicMock(),
        task_repository=MagicMock(),
        batch_repository=MagicMock(),
        worker=worker,
        event_publisher_invoker=MagicMock(),
        worker_id="worker-1",
    )
    row = {
        "kid": 17,
        "lease_token": "lease-1",
        "task_type": "ENTITY_DISCOVERY",
        "knowledge_base_id": 193,
        "fs_entry_id": 1327,
        "file_path_snapshot": "/demo2.md",
        "request_params": {},
        "extra_params": {
            BYCLAW_RUNTIME_CONTEXT_PARAM: {
                "userCode": "operator-1",
                "resourceId": "42",
                "chatSessionId": "session-1",
            },
        },
        "batch_id": "ed-42ba1c5a387b45489056bb9e1d9c0a8e",
    }

    with patch.object(
        ByClawKnowledgeEntityBackgroundRunner,
        "_finish_claimed",
        new_callable=AsyncMock,
    ):
        await runner._execute_claimed(row)

    assert transport.calls[0]["headers"] == {
        "system-code": "BYCLAW-QA",
        "beyond-token": "token-from-redis",
    }
    assert transport.calls[0]["params"]["resourceId"] == "42"
    redis_client.get.assert_awaited_once_with("SHARE_BFM_USER_CODE_operator-1")
