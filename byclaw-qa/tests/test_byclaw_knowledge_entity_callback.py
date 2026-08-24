from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from by_qa.knowledge_base.api.knowledge_entity_schemas import (
    ProcessingTaskStatus,
    ProcessingTaskType,
)
from by_qa.knowledge_base.services.knowledge_entity_callback import (
    BatchCompletedCallbackInput,
    BatchProgress,
    FileCompletedCallbackInput,
)

from byclaw_knowledge_entity_callback import (
    CALLBACK_CONTEXT_EXTRA_PARAM,
    DINGTALK_TEST_SEND_PATH,
    SAVE_OR_UPDATE_OBJECT_FILES_PATH,
    ByClawKnowledgeEntityCallbackError,
    ByClawKnowledgeEntityProcessingCallback,
)


def _progress() -> BatchProgress:
    return BatchProgress(
        version=3,
        total_count=2,
        completed_count=1,
        succeeded_count=1,
        failed_count=0,
        skipped_count=0,
    )


def _file_event(
    *,
    task_type: ProcessingTaskType = ProcessingTaskType.ENTITY_DISCOVERY,
    status: ProcessingTaskStatus = ProcessingTaskStatus.SUCCEEDED,
    extra_params: dict | None = None,
    result: dict | None = None,
) -> FileCompletedCallbackInput:
    return FileCompletedCallbackInput(
        batch_id="batch-1",
        task_id="task-1",
        task_type=task_type,
        status=status,
        knowledge_base_id="kb-id-1",
        kb_code="kb-code-1",
        file_id="file-1",
        file_path=(
            "/OriginalDocument/source.md"
            if task_type == ProcessingTaskType.ENTITY_DISCOVERY
            else "/KnowledgeEntity/entity.md"
        ),
        progress=_progress(),
        result=result if result is not None else {"ok": True},
        error=None,
        extra_params=extra_params or {},
        completed_at=datetime.now(UTC),
    )


def _callback_context() -> dict:
    return {
        CALLBACK_CONTEXT_EXTRA_PARAM: {
            "userCode": "user-1",
            "chatSessionId": "session-1",
            "resourceId": "42",
        }
    }


@pytest.mark.asyncio
async def test_file_callback_posts_knowledge_file() -> None:
    calls = []
    knowledge_base_name_resolver = AsyncMock(return_value="研发知识库")

    async def post_json(path, payload, headers):
        calls.append((path, payload, headers))
        return {"code": 0}

    callback = ByClawKnowledgeEntityProcessingCallback(
        post_json=post_json,
        beyond_token_resolver=lambda _user_code: "token-1",
        knowledge_base_name_resolver=knowledge_base_name_resolver,
    )
    await callback.on_file_completed(_file_event(extra_params=_callback_context()))

    assert len(calls) == 1
    path, payload, headers = calls[0]
    assert path == SAVE_OR_UPDATE_OBJECT_FILES_PATH
    assert headers == {
        "Content-Type": "application/json",
        "Beyond-Token": "token-1",
        "X-User-Code": "user-1",
        "X-CHAT-SESSION-ID": "session-1",
    }
    object_file = payload["objectFiles"][0]
    assert object_file == {
        "sessionId": "session-1",
        "objectType": "knowledge",
        "objectName": "研发知识库",
        "objectCode": "kb-code-1",
        "fileName": "source.md",
        "filePath": "/OriginalDocument/source.md",
        "version": "1",
        "statusCd": "已完成",
        "extContent": object_file["extContent"],
    }
    assert json.loads(object_file["extContent"]) == {
        "kb_resource_id": "42",
        "kb_id": "kb-id-1",
        "kb_directory": "/OriginalDocument",
    }
    knowledge_base_name_resolver.assert_awaited_once_with("kb-code-1")


@pytest.mark.asyncio
async def test_discovery_callback_posts_related_entity_files() -> None:
    calls = []

    async def post_json(path, payload, headers):
        calls.append((path, payload, headers))
        return {"code": 0}

    callback = ByClawKnowledgeEntityProcessingCallback(
        post_json=post_json,
        beyond_token_resolver=lambda _user_code: "token-1",
        knowledge_base_name_resolver=lambda _kb_code: "研发知识库",
    )
    await callback.on_file_completed(
        _file_event(
            extra_params=_callback_context(),
            result={
                "actions": [
                    {
                        "action": "CREATED",
                        "entityFileId": 11,
                        "filePath": "/KnowledgeEntity/Alpha-Beta.md",
                    },
                    {
                        "action": "ANCHORED",
                        "entityFileId": 12,
                        "filePath": "/KnowledgeEntity/Existing.md",
                    },
                    {
                        "action": "ANCHORED",
                        "entityFileId": 11,
                        "filePath": "/KnowledgeEntity/Alpha-Beta.md",
                    },
                    {"action": "DROPPED", "entityName": "No File"},
                ]
            },
        )
    )

    object_files = calls[0][1]["objectFiles"]
    assert [item["filePath"] for item in object_files] == [
        "/KnowledgeEntity/Alpha-Beta.md",
        "/KnowledgeEntity/Existing.md",
        "/OriginalDocument/source.md",
    ]
    for entity_file in object_files[:2]:
        assert entity_file["sessionId"] == "session-1"
        assert entity_file["objectType"] == "knowledge"
        assert entity_file["objectName"] == "研发知识库"
        assert entity_file["objectCode"] == "kb-code-1"
        assert entity_file["version"] == "1"
        assert entity_file["statusCd"] == "待整理"
        assert json.loads(entity_file["extContent"]) == {
            "kb_resource_id": "42",
            "kb_id": "kb-id-1",
            "kb_directory": "/KnowledgeEntity",
        }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("task_type", "status"),
    [
        (ProcessingTaskType.ENTITY_DISCOVERY, ProcessingTaskStatus.FAILED),
        (ProcessingTaskType.DOCUMENT_ENRICH, ProcessingTaskStatus.SUCCEEDED),
    ],
)
async def test_callback_does_not_post_incomplete_or_enrich_entity_actions(
    task_type: ProcessingTaskType,
    status: ProcessingTaskStatus,
) -> None:
    calls = []

    async def post_json(path, payload, headers):
        calls.append((path, payload, headers))
        return {"code": 0}

    callback = ByClawKnowledgeEntityProcessingCallback(
        post_json=post_json,
        beyond_token_resolver=lambda _user_code: "token-1",
        knowledge_base_name_resolver=lambda _kb_code: "研发知识库",
    )
    await callback.on_file_completed(
        _file_event(
            task_type=task_type,
            status=status,
            extra_params=_callback_context(),
            result={
                "actions": [
                    {
                        "action": "CREATED",
                        "entityFileId": 11,
                        "filePath": "/KnowledgeEntity/Partial.md",
                    }
                ]
            },
        )
    )

    assert len(calls[0][1]["objectFiles"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("task_type", "status", "expected_status"),
    [
        (
            ProcessingTaskType.ENTITY_DISCOVERY,
            ProcessingTaskStatus.FAILED,
            "发现失败-待重试",
        ),
        (
            ProcessingTaskType.ENTITY_DISCOVERY,
            ProcessingTaskStatus.SKIPPED,
            "待发现",
        ),
        (
            ProcessingTaskType.DOCUMENT_ENRICH,
            ProcessingTaskStatus.SUCCEEDED,
            "已完成",
        ),
        (
            ProcessingTaskType.DOCUMENT_ENRICH,
            ProcessingTaskStatus.FAILED,
            "整理失败-待重试",
        ),
        (
            ProcessingTaskType.DOCUMENT_ENRICH,
            ProcessingTaskStatus.SKIPPED,
            "待整理",
        ),
    ],
)
async def test_file_callback_maps_terminal_statuses(
    task_type: ProcessingTaskType,
    status: ProcessingTaskStatus,
    expected_status: str,
) -> None:
    calls = []

    def post_json(path, payload, headers):
        calls.append((path, payload, headers))
        return {"resultCode": "0"}

    callback = ByClawKnowledgeEntityProcessingCallback(
        post_json=post_json,
        beyond_token_resolver=lambda _user_code: "token-1",
        knowledge_base_name_resolver=lambda _kb_code: "研发知识库",
    )
    await callback.on_file_completed(
        _file_event(
            task_type=task_type,
            status=status,
            extra_params=_callback_context(),
        )
    )

    object_file = calls[0][1]["objectFiles"][0]
    assert object_file["statusCd"] == expected_status
    assert object_file["objectType"] == "knowledge"
    assert object_file["objectCode"] == "kb-code-1"
    assert object_file["objectName"] == "研发知识库"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "extra_params",
    [
        {},
        {CALLBACK_CONTEXT_EXTRA_PARAM: {"userCode": "user-1"}},
        {CALLBACK_CONTEXT_EXTRA_PARAM: {"chatSessionId": "session-1"}},
    ],
)
async def test_file_callback_skips_when_either_header_is_missing(
    extra_params: dict,
) -> None:
    post_json = MagicMock()
    callback = ByClawKnowledgeEntityProcessingCallback(post_json=post_json)

    await callback.on_file_completed(_file_event(extra_params=extra_params))

    post_json.assert_not_called()


@pytest.mark.asyncio
async def test_file_callback_rejects_business_error_response() -> None:
    callback = ByClawKnowledgeEntityProcessingCallback(
        post_json=lambda *_: {"resultCode": "-1", "resultMsg": "failed"},
        beyond_token_resolver=lambda _user_code: "token-1",
        knowledge_base_name_resolver=lambda _kb_code: "研发知识库",
    )

    with pytest.raises(ByClawKnowledgeEntityCallbackError, match="failed"):
        await callback.on_file_completed(_file_event(extra_params=_callback_context()))


@pytest.mark.asyncio
async def test_callback_resolves_knowledge_base_name_from_database() -> None:
    settings = MagicMock()
    connection = MagicMock()
    connection.close = AsyncMock()
    connection_factory = AsyncMock(return_value=connection)
    repository = MagicMock()
    repository.get_by_code = AsyncMock(return_value={"kb_name": "研发知识库"})

    with (
        patch(
            "byclaw_knowledge_entity_callback.get_settings",
            return_value=settings,
        ),
        patch(
            "byclaw_knowledge_entity_callback.build_connection_factory",
            return_value=connection_factory,
        ) as build_factory,
        patch(
            "byclaw_knowledge_entity_callback.KnowledgeBaseRepository",
            return_value=repository,
        ),
    ):
        callback = ByClawKnowledgeEntityProcessingCallback()
        name = await callback._resolve_knowledge_base_name("168")

    assert name == "研发知识库"
    build_factory.assert_called_once_with(settings)
    connection_factory.assert_awaited_once_with()
    repository.get_by_code.assert_awaited_once_with(connection.cursor(), "168")
    connection.close.assert_awaited_once_with()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("task_type", "task_name"),
    [
        (ProcessingTaskType.ENTITY_DISCOVERY, "知识实体发现"),
        (ProcessingTaskType.DOCUMENT_ENRICH, "知识实体整理"),
    ],
)
async def test_batch_callback_sends_chinese_summary_to_requesting_user(
    task_type: ProcessingTaskType,
    task_name: str,
) -> None:
    calls = []

    async def get_json(path, params, headers):
        calls.append((path, params, headers))
        return {"resultCode": "0"}

    callback = ByClawKnowledgeEntityProcessingCallback(
        get_json=get_json,
        user_id_resolver=lambda _user_code: "10000077",
        beyond_token_resolver=lambda _user_code: "token-1",
    )
    event = BatchCompletedCallbackInput(
        batch_id="batch-1",
        task_type=task_type,
        knowledge_base_id="kb-id-1",
        kb_code="kb-code-1",
        progress=BatchProgress(
            version=3,
            total_count=2,
            completed_count=2,
            succeeded_count=2,
            failed_count=0,
            skipped_count=0,
        ),
        extra_params=_callback_context(),
        completed_at=datetime.now(UTC),
    )

    await callback.on_batch_completed(event)

    assert calls == [
        (
            DINGTALK_TEST_SEND_PATH,
            {
                "senderUserId": "10000077",
                "receiverUserId": "10000077",
                "content": (
                    f"【{task_name}】任务已全部成功完成\n"
                    "知识库资源 ID：42\n"
                    "批次：batch-1\n"
                    "总计：2 个文件\n"
                    "成功：2 个\n"
                    "失败：0 个\n"
                    "跳过：0 个"
                ),
            },
            {"Beyond-Token": "token-1"},
        )
    ]


@pytest.mark.asyncio
async def test_batch_callback_skips_without_requesting_user() -> None:
    get_json = MagicMock()
    callback = ByClawKnowledgeEntityProcessingCallback(get_json=get_json)
    event = BatchCompletedCallbackInput(
        batch_id="batch-1",
        task_type=ProcessingTaskType.DOCUMENT_ENRICH,
        knowledge_base_id="kb-id-1",
        kb_code="kb-code-1",
        progress=_progress(),
    )

    await callback.on_batch_completed(event)

    get_json.assert_not_called()


@pytest.mark.asyncio
async def test_file_callback_resolves_beyond_token_from_user_code() -> None:
    redis_client = MagicMock()
    redis_client.get = AsyncMock(return_value=b"real-user-1")
    redis_client.hget = AsyncMock(return_value=b"token-from-redis")
    calls = []

    def post_json(path, payload, headers):
        calls.append((path, payload, headers))
        return {"code": 0}

    with patch(
        "byclaw_knowledge_entity_callback.init_shared_redis_from_env",
        return_value=redis_client,
    ):
        callback = ByClawKnowledgeEntityProcessingCallback(
            post_json=post_json,
            knowledge_base_name_resolver=lambda _kb_code: "研发知识库",
        )
        await callback.on_file_completed(_file_event(extra_params=_callback_context()))

    redis_client.get.assert_awaited_once_with("SHARE_BFM_USER_CODE_user-1")
    redis_client.hget.assert_awaited_once_with(
        "user:real-user-1:login:auth",
        "Beyond-Token",
    )
    assert calls[0][2]["Beyond-Token"] == "token-from-redis"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("user_id", "token", "expected_message"),
    [
        (None, None, "user mapping"),
        ("real-user-1", None, "Beyond-Token"),
    ],
)
async def test_file_callback_fails_without_redis_login_token(
    user_id: str | None,
    token: str | None,
    expected_message: str,
) -> None:
    redis_client = MagicMock()
    redis_client.get = AsyncMock(return_value=user_id)
    redis_client.hget = AsyncMock(return_value=token)
    post_json = MagicMock()

    with patch(
        "byclaw_knowledge_entity_callback.init_shared_redis_from_env",
        return_value=redis_client,
    ):
        callback = ByClawKnowledgeEntityProcessingCallback(
            post_json=post_json,
            knowledge_base_name_resolver=lambda _kb_code: "研发知识库",
        )
        with pytest.raises(
            ByClawKnowledgeEntityCallbackError,
            match=expected_message,
        ):
            await callback.on_file_completed(
                _file_event(extra_params=_callback_context())
            )

    post_json.assert_not_called()


@pytest.mark.asyncio
async def test_discovery_transport_uses_service_prefix_and_keeps_shared_redis_open() -> (
    None
):
    redis_client = MagicMock()
    redis_client.aclose = AsyncMock()
    discovery_client = MagicMock()
    discovery_client.discover = AsyncMock(
        return_value=SimpleNamespace(
            protocol="https",
            host="be.internal",
            port=8443,
            path_prefix="gateway",
        )
    )
    discovery_client.close = AsyncMock()
    response = MagicMock(is_success=True, status_code=200)
    response.json.return_value = {"code": 0}
    http_client = MagicMock()
    http_client.__aenter__ = AsyncMock(return_value=http_client)
    http_client.__aexit__ = AsyncMock(return_value=False)
    http_client.post = AsyncMock(return_value=response)

    with (
        patch(
            "byclaw_knowledge_entity_callback.init_shared_redis_from_env",
            return_value=redis_client,
        ),
        patch(
            "byclaw_knowledge_entity_callback.DiscoveryClient",
            return_value=discovery_client,
        ),
        patch(
            "byclaw_knowledge_entity_callback.httpx.AsyncClient",
            return_value=http_client,
        ),
    ):
        callback = ByClawKnowledgeEntityProcessingCallback()
        result = await callback._post_by_discovery(
            payload={"objectFiles": []},
            headers={"X-User-Code": "user-1"},
        )

    assert result == {"code": 0}
    discovery_client.discover.assert_awaited_once_with(
        "ByaiService",
        health_threshold_ms=-1,
    )
    http_client.post.assert_awaited_once_with(
        "https://be.internal:8443/gateway/byaiService/devloop/operation/"
        "saveOrUpdateObjectFiles",
        json={"objectFiles": []},
    )
    discovery_client.close.assert_awaited_once()
    redis_client.aclose.assert_not_awaited()


@pytest.mark.asyncio
async def test_dingtalk_transport_sends_get_with_query_params() -> None:
    redis_client = MagicMock()
    discovery_client = MagicMock()
    discovery_client.discover = AsyncMock(
        return_value=SimpleNamespace(
            protocol="http",
            host="be.internal",
            port=8080,
            path_prefix="",
        )
    )
    discovery_client.close = AsyncMock()
    response = MagicMock(is_success=True, status_code=200)
    response.json.return_value = {"resultCode": "0"}
    http_client = MagicMock()
    http_client.__aenter__ = AsyncMock(return_value=http_client)
    http_client.__aexit__ = AsyncMock(return_value=False)
    http_client.get = AsyncMock(return_value=response)
    params = {
        "senderUserId": "10000077",
        "receiverUserId": "10000077",
        "content": "任务已完成",
    }

    with (
        patch(
            "byclaw_knowledge_entity_callback.init_shared_redis_from_env",
            return_value=redis_client,
        ),
        patch(
            "byclaw_knowledge_entity_callback.DiscoveryClient",
            return_value=discovery_client,
        ),
        patch(
            "byclaw_knowledge_entity_callback.httpx.AsyncClient",
            return_value=http_client,
        ),
    ):
        callback = ByClawKnowledgeEntityProcessingCallback()
        result = await callback._get_by_discovery(
            params=params,
            headers={"Beyond-Token": "token-1"},
        )

    assert result == {"resultCode": "0"}
    http_client.get.assert_awaited_once_with(
        "http://be.internal:8080/byaiService/open/api/v1/dingtalk/testSend",
        params=params,
    )
    discovery_client.close.assert_awaited_once()
