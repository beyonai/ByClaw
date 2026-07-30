"""Tests for api.py — the three ByResourceId endpoints."""

import os
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from httpx import AsyncClient, ASGITransport

from api import app


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
                },
                files={"fileContent": ("test.pdf", b"fake-pdf", "application/pdf")},
            )
        body = resp.json()
        assert body["resultCode"] == "0"
        mock_service.upload_file.assert_called_once()
        req_arg = mock_service.upload_file.call_args[0][0]
        assert req_arg.kb_code == "1"


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
