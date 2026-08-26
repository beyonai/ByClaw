from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from by_qa.knowledge_base.events import (
    ResourceEventType,
    build_file_completed_event,
    build_resource_event,
    parse_knowledge_event,
)

from byclaw_knowledge_event_publisher import (
    CALLBACK_CONTEXT_EXTRA_PARAM,
    DINGTALK_TEST_SEND_PATH,
    ByClawKnowledgeEventPublisher,
)
from byclaw_userfs_storage import (
    CHAT_SESSION_ID_HEADER,
    RESOURCE_ID_HEADER,
    USER_CODE_HEADER,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)


def _publisher(calls, **kwargs):
    async def post_json(path, payload, headers):
        calls.append((path, payload, headers))
        return {"resultCode": "0"}

    return ByClawKnowledgeEventPublisher(
        post_json=post_json,
        beyond_token_resolver=lambda _: "token-1",
        knowledge_base_resolver=lambda _: {"kid": 168, "kb_name": "研发知识库"},
        **kwargs,
    )


def _bind_context():
    return set_byclaw_userfs_headers(
        {
            USER_CODE_HEADER: "user-1",
            CHAT_SESSION_ID_HEADER: "session-1",
            RESOURCE_ID_HEADER: "42",
        }
    )


def _semantic_event(
    event_type="semantic.discovery.file.completed", **payload_overrides
):
    payload = {
        "batchId": "batch-1",
        "taskId": "task-1",
        "taskType": "ENTITY_DISCOVERY",
        "status": "SUCCEEDED",
        "knowledgeBaseId": "168",
        "fileId": "10",
        "filePath": "/OriginalDocument/source.md",
        "progress": {
            "version": 1,
            "totalCount": 1,
            "completedCount": 1,
            "succeededCount": 1,
            "failedCount": 0,
            "skippedCount": 0,
        },
        "result": {"actions": []},
        "error": None,
    }
    payload.update(payload_overrides)
    return parse_knowledge_event(
        {
            "eventId": "event-1",
            "eventType": event_type,
            "eventVersion": 1,
            "knCode": "kb-1",
            "occurredAt": datetime.now(UTC).isoformat(),
            "payload": payload,
        }
    )


@pytest.mark.asyncio
async def test_discovery_uses_persisted_batch_context_and_reports_entity_files():
    calls = []
    publisher = _publisher(
        calls,
        batch_context_resolver=lambda *_: {
            CALLBACK_CONTEXT_EXTRA_PARAM: {
                "userCode": "user-1",
                "chatSessionId": "session-1",
                "resourceId": "42",
            }
        },
    )
    event = _semantic_event(
        result={
            "actions": [
                {
                    "action": "CREATED",
                    "entityFileId": 11,
                    "filePath": "/KnowledgeEntity/Alpha.md",
                },
                {
                    "action": "ANCHORED",
                    "entityFileId": 11,
                    "filePath": "/KnowledgeEntity/Alpha.md",
                },
                {"action": "DROPPED", "filePath": "/KnowledgeEntity/Drop.md"},
            ]
        }
    )

    await publisher.publish(event)

    assert [item["filePath"] for item in calls[0][1]["objectFiles"]] == [
        "/KnowledgeEntity/Alpha.md",
        "/OriginalDocument/source.md",
    ]
    assert [item["statusCd"] for item in calls[0][1]["objectFiles"]] == [
        "待整理",
        "已完成",
    ]
    assert calls[0][2]["Beyond-Token"] == "token-1"
    assert json.loads(calls[0][1]["objectFiles"][0]["extContent"]) == {
        "kb_resource_id": "42",
        "kb_id": "168",
        "kb_directory": "/KnowledgeEntity",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("event_type", "source", "target", "items", "result", "path", "status"),
    [
        (
            ResourceEventType.DIRECTORY_CREATED,
            None,
            "/Docs",
            [],
            None,
            "/Docs",
            "已完成",
        ),
        (
            ResourceEventType.DIRECTORY_UPDATED,
            "/Docs",
            "/Notes",
            [],
            None,
            "/Notes",
            "已完成",
        ),
        (
            ResourceEventType.DIRECTORY_DELETED,
            "/Docs",
            None,
            [],
            None,
            "/Docs",
            "已删除",
        ),
        (
            ResourceEventType.FILE_IMPORTED,
            None,
            "/Docs/a.md",
            [],
            {"total": 1, "succeeded": 1, "failed": 0},
            "/Docs/a.md",
            "待构建",
        ),
        (
            ResourceEventType.FILE_UPDATED,
            "/Docs/a.md",
            "/Docs/a.md",
            [],
            {"success": True},
            "/Docs/a.md",
            "待构建",
        ),
        (
            ResourceEventType.FILE_DELETED,
            "/Docs/a.md",
            None,
            [],
            None,
            "/Docs/a.md",
            "已删除",
        ),
        (
            ResourceEventType.RESOURCE_MOVED,
            "/Docs/a.md",
            "/Archive",
            [
                {
                    "sourcePath": "/Docs/a.md",
                    "targetPath": "/Archive/a.md",
                    "success": True,
                    "error": None,
                }
            ],
            {"total": 1, "succeeded": 1, "failed": 0},
            "/Archive/a.md",
            "已完成",
        ),
    ],
)
async def test_all_resource_events_are_reported(
    event_type, source, target, items, result, path, status
):
    calls = []
    publisher = _publisher(calls)
    event = build_resource_event(
        event_type=event_type,
        kb_code="kb-1",
        source_path=source,
        target_path=target,
        items=items,
        result=result,
    )
    token = _bind_context()
    try:
        await publisher.publish(event)
    finally:
        reset_byclaw_userfs_headers(token)

    object_file = calls[0][1]["objectFiles"][0]
    assert object_file["filePath"] == path
    assert object_file["statusCd"] == status
    assert object_file["objectName"] == "研发知识库"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("build_status", "expected"),
    [
        ("complete", "已完成"),
        ("failed", "构建失败-待重试"),
        ("unsupported", "不支持构建"),
    ],
)
async def test_build_terminal_events_are_reported(build_status, expected):
    calls = []
    publisher = _publisher(calls)
    kwargs = {
        "kb_code": "kb-1",
        "task_id": "task-1",
        "file_path": "/Docs/a.md",
        "status": build_status,
        "current_step": "complete" if build_status == "complete" else "markdown",
    }
    if build_status == "complete":
        kwargs.update(chunk_count=2, line_count=10)
    else:
        kwargs.update(error_code="FAILED", error_message="failed")
    event = build_file_completed_event(**kwargs)
    token = _bind_context()
    try:
        await publisher.publish(event)
    finally:
        reset_byclaw_userfs_headers(token)

    assert calls[0][1]["objectFiles"][0]["statusCd"] == expected


@pytest.mark.asyncio
async def test_import_and_build_use_same_canonical_root_file_path():
    calls = []
    publisher = _publisher(calls)
    imported = build_resource_event(
        event_type=ResourceEventType.FILE_IMPORTED,
        kb_code="kb-1",
        source_path=None,
        target_path="/ByDC.md",
        result={"total": 1, "succeeded": 1, "failed": 0},
    )
    built = build_file_completed_event(
        kb_code="kb-1",
        task_id="task-1",
        file_path="ByDC.md",
        status="complete",
        current_step="complete",
        chunk_count=1,
        line_count=1,
    )

    token = _bind_context()
    try:
        await publisher.publish(imported)
        await publisher.publish(built)
    finally:
        reset_byclaw_userfs_headers(token)

    object_files = [call[1]["objectFiles"][0] for call in calls]
    assert [item["filePath"] for item in object_files] == [
        "/ByDC.md",
        "/ByDC.md",
    ]
    assert [json.loads(item["extContent"])["kb_directory"] for item in object_files] == [
        "/",
        "/",
    ]


@pytest.mark.asyncio
async def test_missing_callback_headers_skips_delivery():
    post_json = MagicMock()
    publisher = ByClawKnowledgeEventPublisher(post_json=post_json)
    event = build_resource_event(
        event_type=ResourceEventType.DIRECTORY_CREATED,
        kb_code="kb-1",
        source_path=None,
        target_path="/Docs",
    )

    await publisher.publish(event)

    post_json.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("event_type", "task_type", "task_name"),
    [
        (
            "semantic.discovery.batch.completed",
            "ENTITY_DISCOVERY",
            "知识实体发现",
        ),
        (
            "semantic.enrich.batch.completed",
            "ENTITY_ENRICH",
            "知识实体整理",
        ),
    ],
)
async def test_batch_event_notifies_requesting_user(
    event_type, task_type, task_name
):
    calls = []

    async def get_json(path, params, headers):
        calls.append((path, params, headers))
        return {"resultCode": "0"}

    post_json = MagicMock()
    publisher = ByClawKnowledgeEventPublisher(
        post_json=post_json,
        get_json=get_json,
        user_id_resolver=lambda _: "10000077",
        beyond_token_resolver=lambda _: "token-1",
        batch_context_resolver=lambda *_: {
            CALLBACK_CONTEXT_EXTRA_PARAM: {
                "userCode": "0027011322",
                "chatSessionId": "session-1",
                "resourceId": "42",
            }
        },
    )
    event = parse_knowledge_event(
        {
            "eventId": "event-2",
            "eventType": event_type,
            "eventVersion": 1,
            "knCode": "kb-1",
            "occurredAt": datetime.now(UTC).isoformat(),
            "payload": {
                "batchId": "batch-1",
                "taskType": task_type,
                "knowledgeBaseId": "168",
                "progress": {
                    "version": 3,
                    "totalCount": 5,
                    "completedCount": 5,
                    "succeededCount": 4,
                    "failedCount": 1,
                    "skippedCount": 0,
                },
            },
        }
    )

    await publisher.publish(event)

    post_json.assert_not_called()
    assert calls == [
        (
            DINGTALK_TEST_SEND_PATH,
            {
                "senderUserId": "10000077",
                "receiverUserId": "10000077",
                "content": (
                    f"【{task_name}】任务已完成，部分文件处理失败\n"
                    "知识库资源 ID：42\n"
                    "批次：batch-1\n"
                    "总计：5 个文件\n"
                    "成功：4 个\n"
                    "失败：1 个\n"
                    "跳过：0 个"
                ),
            },
            {"Beyond-Token": "token-1"},
        )
    ]


@pytest.mark.asyncio
async def test_batch_event_skips_without_requesting_user():
    get_json = MagicMock()
    publisher = ByClawKnowledgeEventPublisher(
        get_json=get_json,
        batch_context_resolver=lambda *_: {},
    )
    event = parse_knowledge_event(
        {
            "eventId": "event-2",
            "eventType": "semantic.enrich.batch.completed",
            "eventVersion": 1,
            "knCode": "kb-1",
            "occurredAt": datetime.now(UTC).isoformat(),
            "payload": {
                "batchId": "batch-1",
                "taskType": "ENTITY_ENRICH",
                "knowledgeBaseId": "168",
                "progress": {
                    "version": 1,
                    "totalCount": 0,
                    "completedCount": 0,
                    "succeededCount": 0,
                    "failedCount": 0,
                    "skippedCount": 0,
                },
            },
        }
    )

    await publisher.publish(event)

    get_json.assert_not_called()


@pytest.mark.asyncio
async def test_dingtalk_transport_sends_get_with_query_params():
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
            "byclaw_knowledge_event_publisher.init_shared_redis_from_env",
            return_value=redis_client,
        ),
        patch(
            "byclaw_knowledge_event_publisher.DiscoveryClient",
            return_value=discovery_client,
        ),
        patch(
            "byclaw_knowledge_event_publisher.httpx.AsyncClient",
            return_value=http_client,
        ),
    ):
        publisher = ByClawKnowledgeEventPublisher()
        result = await publisher._get_by_discovery(
            params=params,
            headers={"Beyond-Token": "token-1"},
        )

    assert result == {"resultCode": "0"}
    http_client.get.assert_awaited_once_with(
        "http://be.internal:8080/byaiService/open/api/v1/dingtalk/testSend",
        params=params,
    )
    discovery_client.close.assert_awaited_once()
