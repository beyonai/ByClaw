"""Tests for api.py resource-scoped endpoints."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from httpx import AsyncClient, ASGITransport

from by_qa.knowledge_base.infrastructure.storage import (
    StorageAuthenticationError,
    StorageOperationError,
)
from api import app


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
        assert body["resultObject"]["knCode"] == "11029731"
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
# buildPreviewByResourceId
# ---------------------------------------------------------------------------

class TestBuildPreviewByResourceId:

    @pytest.mark.asyncio
    async def test_success_returns_pdf_stream(self, client, _patch_redis_config):
        from byclaw_userfs_storage import get_byclaw_resource_id

        _patch_redis_config.return_value = {"resourceCode": "155"}
        mock_service = AsyncMock()

        async def build_preview(request):
            assert get_byclaw_resource_id() == "11029731"
            assert request.kb_code == "155"
            assert request.file_path == "/门户设计/api.pptx"
            return b"%PDF-1.7\npreview"

        mock_service.build_preview.side_effect = build_preview
        with patch("api.resolve_knowledge_base_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/buildPreviewByResourceId",
                json={
                    "resourceId": 11029731,
                    "filePath": "/门户设计/api.pptx",
                },
            )

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content == b"%PDF-1.7\npreview"

    @pytest.mark.asyncio
    async def test_unexpected_storage_error_returns_business_error(
        self, client, _patch_redis_config
    ):
        _patch_redis_config.return_value = {"resourceCode": "155"}
        mock_service = AsyncMock()
        mock_service.build_preview.side_effect = RuntimeError("storage offline")

        with patch("api.resolve_knowledge_base_service", return_value=mock_service):
            resp = await client.post(
                "/api/v1/buildPreviewByResourceId",
                json={
                    "resourceId": 11029731,
                    "filePath": "/门户设计/api.pptx",
                },
            )

        body = resp.json()
        assert body["resultCode"] == "-1"
        assert body["resultMsg"] == "storage offline"


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
        assert data[0]["knCode"] == "100"

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
        assert data[0]["knCode"] == "100"
        assert data[1]["knCode"] == "200"
