"""Tests for api.py resource-scoped endpoints."""

import json

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from httpx import AsyncClient, ASGITransport

from by_qa.knowledge_base.infrastructure.storage import (
    StorageAuthenticationError,
    StorageOperationError,
)
from api import _inject_knowledge_entity_callback_context, app
from byclaw_knowledge_entity_callback import CALLBACK_CONTEXT_EXTRA_PARAM
from byclaw_userfs_storage import RESOURCE_ID_HEADER


@pytest.fixture(autouse=True)
def _patch_resourcefs_config():
    """Default ResourceFS lookup to absent so legacy Redis tests stay focused."""
    with patch(
        "api.get_kg_doc_from_resourcefs",
        new_callable=AsyncMock,
    ) as mock_fn:
        mock_fn.return_value = None
        yield mock_fn


@pytest.fixture
def _patch_redis_config():
    """Patch get_kg_doc_from_redis so kb_code lookups are mocked."""
    with patch("api.get_kg_doc_from_redis", new_callable=AsyncMock) as mock_fn:
        yield mock_fn


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def test_callback_context_is_injected_without_overwriting_extra_params():
    body = _inject_knowledge_entity_callback_context(
        b'{"knCode":"kb-1","extraParams":{"requestId":"request-1"}}',
        user_code="user-1",
        chat_session_id="session-1",
        resource_id="42",
    )

    payload = json.loads(body)
    assert payload["extraParams"] == {
        "requestId": "request-1",
        CALLBACK_CONTEXT_EXTRA_PARAM: {
            "userCode": "user-1",
            "chatSessionId": "session-1",
            "resourceId": "42",
        },
    }


def test_callback_context_cannot_be_spoofed_without_request_headers():
    body = _inject_knowledge_entity_callback_context(
        (
            b'{"knCode":"kb-1","extraParams":'
            b'{"_byclawCallbackContext":{"userCode":"fake",'
            b'"chatSessionId":"fake"}}}'
        ),
        user_code="",
        chat_session_id="",
        resource_id="",
    )

    payload = json.loads(body)
    assert CALLBACK_CONTEXT_EXTRA_PARAM not in payload["extraParams"]


def test_user_code_is_persisted_for_async_storage_without_chat_session():
    body = _inject_knowledge_entity_callback_context(
        b'{"knCode":"kb-1"}',
        user_code="user-1",
        chat_session_id="",
        resource_id="42",
    )

    payload = json.loads(body)
    assert payload["extraParams"][CALLBACK_CONTEXT_EXTRA_PARAM] == {
        "userCode": "user-1",
        "chatSessionId": "",
        "resourceId": "42",
    }


@pytest.mark.asyncio
async def test_entity_discovery_route_persists_callback_headers(client):
    mock_service = AsyncMock()
    mock_service.discover_knowledge_entities.return_value = {
        "batchId": "batch-1",
        "tasks": [],
    }
    with (
        patch(
            "by_qa.main._get_or_build_knowledge_entity_processing_service",
            new_callable=AsyncMock,
            return_value=mock_service,
        ),
        patch("by_qa.main._build_model_config_provider", return_value=object()),
    ):
        response = await client.post(
            "/api/v1/knowledgeItems/entityDiscovery",
            json={
                "knCode": "kb-1",
                "filePath": "/OriginalDocument/source.md",
                "extraParams": {"requestId": "request-1"},
            },
            headers={
                "X-User-Code": "user-1",
                "X-CHAT-SESSION-ID": "session-1",
                RESOURCE_ID_HEADER: "42",
            },
        )

    assert response.json()["resultCode"] == "0"
    request = mock_service.discover_knowledge_entities.call_args.args[0]
    assert request.extra_params == {
        "requestId": "request-1",
        CALLBACK_CONTEXT_EXTRA_PARAM: {
            "userCode": "user-1",
            "chatSessionId": "session-1",
            "resourceId": "42",
        },
    }


@pytest.mark.asyncio
async def test_entity_enrich_route_drops_spoofed_context_without_headers(client):
    mock_service = AsyncMock()
    mock_service.enrich_knowledge_entities.return_value = {
        "batchId": "batch-1",
        "tasks": [],
    }
    with (
        patch(
            "by_qa.main._get_or_build_knowledge_entity_processing_service",
            new_callable=AsyncMock,
            return_value=mock_service,
        ),
        patch("by_qa.main._build_model_config_provider", return_value=object()),
    ):
        response = await client.post(
            "/api/v1/knowledgeItems/entityEnrich",
            json={
                "knCode": "kb-1",
                "filePath": "/KnowledgeEntity/entity.md",
                "extraParams": {
                    CALLBACK_CONTEXT_EXTRA_PARAM: {
                        "userCode": "fake",
                        "chatSessionId": "fake",
                    }
                },
            },
        )

    assert response.json()["resultCode"] == "0"
    request = mock_service.enrich_knowledge_entities.call_args.args[0]
    assert CALLBACK_CONTEXT_EXTRA_PARAM not in request.extra_params


# ---------------------------------------------------------------------------
# importByResourceId
# ---------------------------------------------------------------------------

class TestImportByResourceId:

    @pytest.mark.asyncio
    async def test_missing_resource_id(self, client):
        resp = await client.post(
            "/api/v1/knowledgeItems/importByResourceId",
            data={"filePath": "/test.pdf"},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "resourceId" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_unresolvable_resource_id(self, client, _patch_redis_config):
        _patch_redis_config.return_value = None
        resp = await client.post(
            "/api/v1/knowledgeItems/importByResourceId",
            data={"resourceId": "999"},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "cannot resolve" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_config_missing_resource_code(self, client, _patch_redis_config):
        _patch_redis_config.return_value = {}
        resp = await client.post(
            "/api/v1/knowledgeItems/importByResourceId",
            data={"resourceId": "999"},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "cannot resolve" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_success_delegates_to_service(self, client, _patch_redis_config):
        _patch_redis_config.return_value = {"resourceCode": "1"}
        mock_service = AsyncMock()
        with patch("api.resolve_knowledge_item_ingestion_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/knowledgeItems/importByResourceId",
                data={
                    "resourceId": "100",
                    "filePath": "/docs/test.pdf",
                    "fileDescription": "desc",
                    "processFrontMatter": "false",
                },
                files={"fileContent": ("test.pdf", b"fake-pdf", "application/pdf")},
            )
        body = resp.json()
        assert body["resultCode"] == "0"
        mock_service.upload_file.assert_called_once()
        req_arg = mock_service.upload_file.call_args[0][0]
        assert req_arg.kb_code == "1"
        assert req_arg.process_front_matter is False


# ---------------------------------------------------------------------------
# fileToMarkdownIndexByResourceId
# ---------------------------------------------------------------------------

class TestFileToMarkdownIndexByResourceId:

    @pytest.mark.asyncio
    async def test_missing_resource_id(self, client):
        resp = await client.post(
            "/api/v1/fileToMarkdownIndexByResourceId",
            json={"filePath": "/test.pdf"},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "resourceId" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_unresolvable_resource_id(self, client, _patch_redis_config):
        _patch_redis_config.return_value = None
        resp = await client.post(
            "/api/v1/fileToMarkdownIndexByResourceId",
            json={"resourceId": "999", "filePath": "/test.pdf"},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "cannot resolve" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_success(self, client, _patch_redis_config):
        from byclaw_userfs_storage import build_byclaw_userfs_headers, get_byclaw_resource_id

        _patch_redis_config.return_value = {"resourceCode": "5"}
        mock_service = AsyncMock()
        mock_service.create_file_to_markdown_index_task.return_value = "task-1"
        background_context = {}

        async def capture_background_context(*args, **kwargs):
            background_context["headers"] = build_byclaw_userfs_headers()
            background_context["resource_id"] = get_byclaw_resource_id()

        mock_service.execute_file_to_markdown_index_task.side_effect = capture_background_context
        with (
            patch("api.resolve_knowledge_item_ingestion_service", return_value=mock_service),
            patch("api.resolve_document_chunking_service", return_value=AsyncMock()),
        ):
            resp = await client.post(
                "/api/v1/fileToMarkdownIndexByResourceId",
                json={"resourceId": "100", "filePath": "/docs/test.pdf"},
                headers={"Beyond-Token": "token-123"},
            )
        body = resp.json()
        assert body["resultCode"] == "0"
        call_args = mock_service.create_file_to_markdown_index_task.call_args[0][0]
        assert call_args.kb_code == "5"
        assert background_context == {
            "headers": {
                "system-code": "BYCLAW-QA",
                "beyond-token": "token-123",
            },
            "resource_id": "100",
        }

    @pytest.mark.asyncio
    async def test_resourcefs_config_is_preferred(
        self,
        client,
        _patch_resourcefs_config,
        _patch_redis_config,
    ):
        _patch_resourcefs_config.return_value = {
            "resourceId": 100,
            "resourceCode": "5",
        }
        mock_service = AsyncMock()
        mock_service.create_file_to_markdown_index_task.return_value = "task-1"
        with (
            patch(
                "api.resolve_knowledge_item_ingestion_service",
                return_value=mock_service,
            ),
            patch(
                "api.resolve_document_chunking_service",
                return_value=AsyncMock(),
            ),
        ):
            resp = await client.post(
                "/api/v1/fileToMarkdownIndexByResourceId",
                json={"resourceId": "100", "filePath": "/docs/test.pdf"},
                headers={"Beyond-Token": "token-123"},
            )

        assert resp.json()["resultCode"] == "0"
        assert (
            mock_service.create_file_to_markdown_index_task.call_args[0][0].kb_code
            == "5"
        )
        _patch_redis_config.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_resourcefs_auth_failure_does_not_fall_back_to_redis(
        self,
        client,
        _patch_resourcefs_config,
        _patch_redis_config,
    ):
        _patch_resourcefs_config.side_effect = StorageAuthenticationError(
            "forbidden"
        )
        _patch_redis_config.return_value = {"resourceCode": "5"}

        resp = await client.post(
            "/api/v1/fileToMarkdownIndexByResourceId",
            json={"resourceId": "100", "filePath": "/docs/test.pdf"},
            headers={"Beyond-Token": "token-123"},
        )

        assert resp.json()["resultCode"] == "-1"
        _patch_redis_config.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_resourcefs_operation_error_falls_back_to_redis(
        self,
        client,
        _patch_resourcefs_config,
        _patch_redis_config,
    ):
        _patch_resourcefs_config.side_effect = StorageOperationError("read timeout")
        _patch_redis_config.return_value = {"resourceCode": "5"}
        mock_service = AsyncMock()
        mock_service.create_file_to_markdown_index_task.return_value = "task-1"

        with (
            patch(
                "api.resolve_knowledge_item_ingestion_service",
                return_value=mock_service,
            ),
            patch(
                "api.resolve_document_chunking_service",
                return_value=AsyncMock(),
            ),
        ):
            resp = await client.post(
                "/api/v1/fileToMarkdownIndexByResourceId",
                json={"resourceId": "100", "filePath": "/docs/test.pdf"},
                headers={"Beyond-Token": "token-123"},
            )

        assert resp.json()["resultCode"] == "0"
        _patch_redis_config.assert_awaited_once()


# ---------------------------------------------------------------------------
# listDirByResourceId
# ---------------------------------------------------------------------------


class TestListDirByResourceId:

    @pytest.mark.asyncio
    async def test_success_preserves_kn_code_and_adds_resource_id(
        self, client, _patch_redis_config
    ):
        _patch_redis_config.return_value = {"resourceCode": "155"}
        mock_item = MagicMock()
        mock_item.model_dump.return_value = {
            "knCode": "155",
            "name": "/门户设计/api.md",
            "type": "file",
        }
        mock_result = MagicMock()
        mock_result.data = [mock_item]
        mock_service = AsyncMock()
        mock_service.list_dir.return_value = mock_result

        with patch("api.resolve_knowledge_base_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/listDirByResourceId",
                json={"resourceId": "100", "directoryPath": "/"},
            )

        body = resp.json()
        assert body["resultCode"] == "0"
        item = body["resultObject"]["data"][0]
        assert item["knCode"] == "155"
        assert item["resourceId"] == "100"


# ---------------------------------------------------------------------------
# readFileByResourceId
# ---------------------------------------------------------------------------


class TestReadFileByResourceId:

    @pytest.mark.asyncio
    async def test_success_preserves_kn_code_and_adds_resource_id(
        self, client, _patch_redis_config
    ):
        _patch_redis_config.return_value = {"resourceCode": "155"}
        mock_service = AsyncMock()
        mock_service.read_file.return_value = {
            "knCode": "155",
            "filePath": "/门户设计/api.md",
            "data": "# api",
        }

        with patch("api.resolve_knowledge_base_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/readFileByResourceId",
                json={"resourceId": "100", "filePath": "/门户设计/api.md"},
            )

        body = resp.json()
        assert body["resultCode"] == "0"
        assert body["resultObject"]["knCode"] == "155"
        assert body["resultObject"]["resourceId"] == "100"


# ---------------------------------------------------------------------------
# buildResultByResourceId
# ---------------------------------------------------------------------------

class TestBuildResultByResourceId:

    @pytest.mark.asyncio
    async def test_success_maps_resource_and_returns_build_details(
        self, client, _patch_redis_config
    ):
        from byclaw_userfs_storage import get_byclaw_resource_id

        _patch_redis_config.return_value = {"resourceCode": "155"}
        mock_service = AsyncMock()
        captured = {}

        async def build_result(request):
            captured["resource_id"] = get_byclaw_resource_id()
            captured["kn_code"] = request.kb_code
            captured["file_path"] = request.file_path
            captured["chunk_page"] = request.chunk_page
            return {
                "knCode": "155",
                "filePath": request.file_path,
                "build": {"status": "complete"},
                "chunks": {"total": 3, "data": []},
            }

        mock_service.build_result.side_effect = build_result
        with patch("api.resolve_knowledge_base_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/buildResultByResourceId",
                json={
                    "resourceId": 11029731,
                    "filePath": "/门户设计/api.pptx",
                    "chunkPage": 2,
                    "chunkPageSize": 10,
                    "includeMarkdown": False,
                },
            )

        body = resp.json()
        assert body["resultCode"] == "0"
        assert body["resultObject"]["knCode"] == "155"
        assert body["resultObject"]["resourceId"] == "11029731"
        assert body["resultObject"]["build"]["status"] == "complete"
        assert body["resultObject"]["chunks"]["total"] == 3
        assert captured == {
            "resource_id": "11029731",
            "kn_code": "155",
            "file_path": "/门户设计/api.pptx",
            "chunk_page": 2,
        }

    @pytest.mark.asyncio
    async def test_rejects_invalid_chunk_page(self, client, _patch_redis_config):
        _patch_redis_config.return_value = {"resourceCode": "155"}

        resp = await client.post(
            "/api/v1/buildResultByResourceId",
            json={
                "resourceId": 11029731,
                "filePath": "/门户设计/api.pptx",
                "chunkPage": 0,
            },
        )

        body = resp.json()
        assert body["resultCode"] == "-1"
        assert body["resultMsg"] == "request validation failed"


# ---------------------------------------------------------------------------
# downloadFileByResourceId
# ---------------------------------------------------------------------------

class TestDownloadFileByResourceId:

    @pytest.mark.asyncio
    async def test_success_binds_resource_context(self, client, _patch_redis_config):
        from byclaw_userfs_storage import get_byclaw_resource_id

        _patch_redis_config.return_value = {"resourceCode": "155"}
        mock_service = AsyncMock()
        download_context = {}

        async def capture_download_context(request):
            download_context["resource_id"] = get_byclaw_resource_id()
            download_context["kn_code"] = request.kb_code
            download_context["file_path"] = request.file_path
            return {
                "filename": "api.md",
                "media_type": "text/markdown",
                "content": b"# api",
            }

        mock_service.download_file.side_effect = capture_download_context
        with patch("api.resolve_knowledge_base_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/downloadFileByResourceId",
                json={
                    "resourceId": 11029731,
                    "filePath": "/门户设计/api.md",
                },
            )

        assert resp.status_code == 200
        assert resp.content == b"# api"
        assert download_context == {
            "resource_id": "11029731",
            "kn_code": "155",
            "file_path": "/门户设计/api.md",
        }


# ---------------------------------------------------------------------------
# searchByResourceId
# ---------------------------------------------------------------------------

class TestSearchByResourceId:

    @pytest.mark.asyncio
    async def test_missing_resource_id_list(self, client):
        resp = await client.post(
            "/api/v1/knowledgeItems/searchByResourceId",
            json={"query": "test", "topK": 5},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "resourceIdList" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_empty_resource_id_list(self, client):
        resp = await client.post(
            "/api/v1/knowledgeItems/searchByResourceId",
            json={"resourceIdList": [], "query": "test", "topK": 5},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"

    @pytest.mark.asyncio
    async def test_unresolvable_resource_id(self, client, _patch_redis_config):
        _patch_redis_config.return_value = None
        resp = await client.post(
            "/api/v1/knowledgeItems/searchByResourceId",
            json={
                "resourceIdList": ["999"],
                "query": "test",
                "topK": 5,
                "searchMode": "embedding",
            },
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "cannot resolve" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_success_with_reverse_mapping(self, client, _patch_redis_config):
        _patch_redis_config.return_value = {"resourceCode": "1"}

        mock_item = MagicMock()
        mock_item.model_dump.return_value = {
            "knCode": "1",
            "filePath": "/test.pdf",
            "chunkText": "hello",
            "score": 90,
        }
        mock_service = AsyncMock()
        mock_service.search.return_value = [mock_item]

        with patch("api.resolve_knowledge_item_search_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/knowledgeItems/searchByResourceId",
                json={
                    "resourceIdList": ["100"],
                    "query": "test",
                    "topK": 5,
                    "searchMode": "embedding",
                },
            )
        body = resp.json()
        assert body["resultCode"] == "0"
        data = body["resultObject"]["data"]
        assert len(data) == 1
        assert data[0]["knCode"] == "1"
        assert data[0]["resourceId"] == "100"

    @pytest.mark.asyncio
    async def test_multiple_resource_ids(self, client, _patch_redis_config):
        configs = {
            "100": {"resourceCode": "1"},
            "200": {"resourceCode": "2"},
        }
        _patch_redis_config.side_effect = lambda _redis, rid: configs.get(rid)

        mock_item_1 = MagicMock()
        mock_item_1.model_dump.return_value = {"knCode": "1", "chunkText": "a", "score": 90}
        mock_item_2 = MagicMock()
        mock_item_2.model_dump.return_value = {"knCode": "2", "chunkText": "b", "score": 80}
        mock_service = AsyncMock()
        mock_service.search.return_value = [mock_item_1, mock_item_2]

        with patch("api.resolve_knowledge_item_search_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/knowledgeItems/searchByResourceId",
                json={
                    "resourceIdList": ["100", "200"],
                    "query": "test",
                    "topK": 10,
                    "searchMode": "mixedRecall",
                },
            )
        body = resp.json()
        assert body["resultCode"] == "0"
        data = body["resultObject"]["data"]
        assert data[0]["knCode"] == "1"
        assert data[0]["resourceId"] == "100"
        assert data[1]["knCode"] == "2"
        assert data[1]["resourceId"] == "200"
