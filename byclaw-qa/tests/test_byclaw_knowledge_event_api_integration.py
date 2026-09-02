from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

import api
from byclaw_userfs_storage import (
    CHAT_SESSION_ID_HEADER,
    RESOURCE_ID_HEADER,
    USER_CODE_HEADER,
    get_byclaw_userfs_header_context,
)


class CapturingInvoker:
    def __init__(self):
        self.calls = []

    async def publish(self, event):
        self.calls.append((event, get_byclaw_userfs_header_context()))


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=api.app),
        base_url="http://test",
    ) as value:
        yield value


@pytest.mark.asyncio
async def test_native_resource_route_publishes_after_success_with_request_context(
    client,
):
    invoker = CapturingInvoker()
    service = AsyncMock()
    headers = {
        "X-User-Code": "user-1",
        "X-CHAT-SESSION-ID": "session-1",
        "X-BYCLAW-RESOURCE-ID": "42",
    }
    with (
        patch(
            "by_qa.main._get_or_build_knowledge_base_service",
            new_callable=AsyncMock,
            return_value=service,
        ),
        patch("by_qa.main._knowledge_event_publisher_invoker", invoker),
    ):
        response = await client.post(
            "/api/v1/directories/create",
            json={"knCode": "kb-1", "directoryPath": "/Docs"},
            headers=headers,
        )

    assert response.status_code == 200
    event, context = invoker.calls[0]
    assert event.event_type == "resource.directory.created"
    assert event.payload.target_path == "/Docs"
    assert context[USER_CODE_HEADER] == "user-1"
    assert context[CHAT_SESSION_ID_HEADER] == "session-1"
    assert context[RESOURCE_ID_HEADER] == "42"
    create_request = service.create_directory.await_args.args[0]
    assert create_request.metadata == {"userCode": "user-1"}


def test_resource_id_wrapper_routes_are_not_registered():
    removed_paths = {
        "/api/v1/knowledgeItems/importByResourceId",
        "/api/v1/knowledge-items/importByResourceId",
        "/api/v1/fileToMarkdownIndexByResourceId",
        "/api/v1/knowledgeItems/searchByResourceId",
        "/api/v1/knowledge-items/searchByResourceId",
        "/api/v1/directories/createByResourceId",
        "/api/v1/directories/updateByResourceId",
        "/api/v1/directories/deleteByResourceId",
        "/api/v1/listDirByResourceId",
        "/api/v1/readFileByResourceId",
        "/api/v1/buildResultByResourceId",
        "/api/v1/downloadFileByResourceId",
    }
    registered_paths = {route.path for route in api.app.routes}

    assert removed_paths.isdisjoint(registered_paths)


@pytest.mark.asyncio
async def test_semantic_routes_reject_removed_extra_params(client):
    service = AsyncMock()
    with patch(
        "by_qa.main._get_or_build_knowledge_entity_processing_service",
        new_callable=AsyncMock,
        return_value=service,
    ):
        response = await client.post(
            "/api/v1/knowledgeItems/entityDiscovery",
            json={
                "knCode": "kb-1",
                "filePath": "/OriginalDocument/source.md",
                "extraParams": {"userCode": "spoofed"},
            },
            headers={
                "X-User-Code": "user-1",
                "X-CHAT-SESSION-ID": "session-1",
                "X-BYCLAW-RESOURCE-ID": "42",
            },
        )

    assert response.status_code == 200
    assert response.json()["resultCode"] == "-1"
    assert response.json()["resultMsg"] == "request validation failed"
    service.discover_knowledge_entities.assert_not_awaited()
