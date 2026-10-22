"""Exercise the installed by-qa API through the ByClaw application wrapper."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

import api
from by_qa.knowledge_base.services.errors import (
    KnowledgeBaseConfigurationError,
    KnowledgeBaseValidationError,
)


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=api.app), base_url="http://test"
    ) as value:
        yield value


@pytest.mark.parametrize("count", [0, 12])
async def test_file_count_uses_installed_route_and_preserves_empty_library(client, count):
    service = AsyncMock()
    service.file_count.return_value = {"fileCount": count}
    with patch(
        "by_qa.main._get_or_build_knowledge_base_service", return_value=service
    ):
        response = await client.post(
            "/api/v1/knowledgeBases/fileCount", json={"knCode": "kb-1"}
        )
    assert response.status_code == 200
    assert response.json()["resultObject"] == {"fileCount": count}
    assert service.file_count.await_args.args[0].kb_code == "kb-1"


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (KnowledgeBaseValidationError("knowledge base not found: kb-1"), 422),
        (KnowledgeBaseConfigurationError("dependency not configured"), 503),
        (RuntimeError("unexpected failure"), 500),
    ],
)
async def test_file_count_keeps_actual_error_status_and_no_count(client, error, status):
    service = AsyncMock()
    service.file_count.side_effect = error
    with patch(
        "by_qa.main._get_or_build_knowledge_base_service", return_value=service
    ):
        response = await client.post(
            "/api/v1/knowledgeBases/fileCount", json={"knCode": "kb-1"}
        )
    assert response.status_code == status
    assert response.json()["resultCode"] == "-1"
    assert response.json()["resultObject"] == {}


async def test_file_count_validates_missing_code_before_building_service(client):
    with patch(
        "by_qa.main._get_or_build_knowledge_base_service"
    ) as build_service:
        response = await client.post("/api/v1/knowledgeBases/fileCount", json={})
    assert response.status_code == 422
    assert response.json()["resultObject"] == {}
    build_service.assert_not_awaited()


@pytest.mark.parametrize("path", ["/api/v1/knowledgeItems/import", "/api/v1/knowledge-items/import"])
async def test_raw_zip_preserves_bytes_metadata_and_authenticated_creator(client, path):
    service = AsyncMock()
    with (
        patch(
            "by_qa.main._get_or_build_knowledge_item_ingestion_service",
            return_value=service,
        ),
        patch("by_qa.main._knowledge_event_publisher_invoker", None),
    ):
        response = await client.post(
            path,
            data={
                "knCode": "kb-1",
                "filePath": "/docs/raw.zip",
                "extractZip": "false",
                "processFrontMatter": "false",
                "metadata": '{"owner":"HR","enabled":false,"priority":0,"userCode":"spoofed"}',
            },
            files={"fileContent": ("raw.zip", b"raw ZIP bytes", "application/zip")},
            headers={"X-USER-CODE": "authenticated-user"},
        )
    assert response.status_code == 200
    assert response.json()["resultCode"] == "0"
    assert response.json()["resultObject"]["summary"] == {
        "total": 1, "succeeded": 1, "failed": 0
    }
    request = service.upload_file.await_args.args[0]
    assert request.file_path == "/docs/raw.zip"
    assert request.file_content == b"raw ZIP bytes"
    assert request.extract_zip is False
    assert request.process_front_matter is False
    assert request.metadata == {
        "owner": "HR", "enabled": False, "priority": 0,
        "userCode": "authenticated-user",
    }
