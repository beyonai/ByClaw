"""The installed dev4 ZIP route interoperates with the ByClaw storage provider."""

import io
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

import api
from by_qa.knowledge_base.infrastructure.storage import StorageLocation
from byclaw_knowledge_storage import ByClawKnowledgeStorageProvider


@pytest.mark.parametrize(
    "path", ["/api/v1/knowledgeItems/import", "/api/v1/knowledge-items/import"]
)
async def test_extracted_zip_passes_disk_file_to_provider_and_cleans_up(path):
    content = b"binary-content\x00" * 1024
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("asset.bin", content)
    temporary_paths = []
    streams = []

    async def transport(**kwargs):
        assert kwargs["data"]["spaceType"] == "RESOURCE"
        assert kwargs["data"]["resourceId"] == "10001"
        assert kwargs["data"]["path"] == (
            "/resource/kg_doc/KG_DOC_10001/.bykc/kb-1/raw/origin/asset.bin"
        )
        stream = kwargs["files"]["file"][1]
        streams.append(stream)
        assert stream.read(1024) == content[:1024]
        return {"status_code": 200, "data": {"fileSize": len(content)}}

    provider = ByClawKnowledgeStorageProvider(transport=transport)
    service = AsyncMock()
    service.file_exists.return_value = False

    async def upload_file(request):
        source = request.file_content
        assert isinstance(source, Path) and source.is_file()
        assert source.stat().st_size == len(content)
        assert request.metadata["userCode"] == "authenticated-user"
        temporary_paths.append(source)
        await provider.write(
            StorageLocation("BYCLAW-USER", "/.bykc/kb-1/raw/origin/asset.bin"),
            source,
            content_type="application/octet-stream",
        )
        return {"fs_entry_id": 1, "virtual_path": request.file_path}

    service.upload_file.side_effect = upload_file
    with (
        patch(
            "by_qa.main._get_or_build_knowledge_item_ingestion_service",
            return_value=service,
        ),
        patch(
            "by_qa.main._get_or_build_knowledge_base_service", return_value=AsyncMock()
        ),
        patch("by_qa.main._knowledge_event_publisher_invoker", None),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=api.app), base_url="http://test"
        ) as client:
            response = await client.post(
                path,
                data={"knCode": "kb-1", "filePath": "/docs"},
                files={
                    "fileContent": ("files.zip", archive.getvalue(), "application/zip")
                },
                headers={
                    "X-USER-CODE": "authenticated-user",
                    "beyond-token": "test-token",
                    "X-Byclaw-Resource-Id": "10001",
                },
            )
    assert response.status_code == 200
    assert response.json()["resultObject"]["summary"] == {
        "total": 1,
        "succeeded": 1,
        "failed": 0,
    }
    assert temporary_paths and all(not source.exists() for source in temporary_paths)
    assert streams and all(stream.closed for stream in streams)
