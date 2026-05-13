"""Tests for api.py — the three ByResourceId endpoints."""

import json
import os
import io
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

os.environ.setdefault("MINIO_ENDPOINT", "minio.test:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "test")
os.environ.setdefault("MINIO_SECRET_KEY", "test")
os.environ.setdefault("FILE_STORAGE_MINIO_BUCKET_NAME", "test-bucket")

from httpx import AsyncClient, ASGITransport

from api import app, _minio


@pytest.fixture
def _patch_minio():
    """Patch the module-level _minio client methods."""
    with patch.object(_minio, "get_kg_doc_config", new_callable=AsyncMock) as mock_cfg:
        yield mock_cfg


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
    async def test_unresolvable_resource_id(self, client, _patch_minio):
        _patch_minio.return_value = None
        resp = await client.post(
            "/api/v1/knowledgeItems/importByResourceId",
            data={"resourceId": "999"},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "cannot resolve" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_config_missing_resource_code(self, client, _patch_minio):
        _patch_minio.return_value = {"resourceId": 999}
        resp = await client.post(
            "/api/v1/knowledgeItems/importByResourceId",
            data={"resourceId": "999"},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "cannot resolve" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_success_delegates_to_service(self, client, _patch_minio):
        _patch_minio.return_value = {"resourceId": 100, "resourceCode": "1"}
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
    async def test_unresolvable_resource_id(self, client, _patch_minio):
        _patch_minio.return_value = None
        resp = await client.post(
            "/api/v1/fileToMarkdownIndexByResourceId",
            json={"resourceId": "999", "filePath": "/test.pdf"},
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert "cannot resolve" in body["resultMsg"]

    @pytest.mark.asyncio
    async def test_success(self, client, _patch_minio):
        _patch_minio.return_value = {"resourceId": 100, "resourceCode": "5"}
        mock_service = AsyncMock()
        mock_service.create_file_to_markdown_index_task.return_value = "task-1"
        with (
            patch("api.resolve_knowledge_item_ingestion_service", return_value=mock_service),
            patch("api.resolve_document_chunking_service", return_value=AsyncMock()),
        ):
            resp = await client.post(
                "/api/v1/fileToMarkdownIndexByResourceId",
                json={"resourceId": "100", "filePath": "/docs/test.pdf"},
            )
        body = resp.json()
        assert body["resultCode"] == "0"
        call_args = mock_service.create_file_to_markdown_index_task.call_args[0][0]
        assert call_args.kb_code == "5"


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
    async def test_unresolvable_resource_id(self, client, _patch_minio):
        _patch_minio.return_value = None
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
    async def test_success_with_reverse_mapping(self, client, _patch_minio):
        _patch_minio.return_value = {"resourceId": 100, "resourceCode": "1"}

        mock_item = MagicMock()
        mock_item.model_dump.return_value = {
            "knCode": "1",
            "filePath": "/test.pdf",
            "chunkText": "hello",
            "score": 90,
        }
        mock_service = AsyncMock()
        mock_service.search_v2.return_value = [mock_item]

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
    async def test_multiple_resource_ids(self, client, _patch_minio):
        configs = {
            "100": {"resourceId": 100, "resourceCode": "1"},
            "200": {"resourceId": 200, "resourceCode": "2"},
        }
        _patch_minio.side_effect = lambda rid: configs.get(rid)

        mock_item_1 = MagicMock()
        mock_item_1.model_dump.return_value = {"knCode": "1", "chunkText": "a", "score": 90}
        mock_item_2 = MagicMock()
        mock_item_2.model_dump.return_value = {"knCode": "2", "chunkText": "b", "score": 80}
        mock_service = AsyncMock()
        mock_service.search_v2.return_value = [mock_item_1, mock_item_2]

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
