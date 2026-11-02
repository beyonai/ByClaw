"""Disk-backed writes use the existing multipart upload contract."""

import asyncio
import io
from pathlib import Path

import httpx
import pytest

from by_qa.knowledge_base.infrastructure.storage import (
    StorageLocation,
    StorageOperationError,
)

from byclaw_knowledge_storage import ByClawKnowledgeStorageProvider
from byclaw_userfs_storage import (
    ByClawUserFsKnowledgeStorageProvider,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider_type", "resource_id", "space_type"),
    [
        (ByClawUserFsKnowledgeStorageProvider, None, "USER"),
        (ByClawKnowledgeStorageProvider, None, "USER"),
        (ByClawKnowledgeStorageProvider, "10001", "RESOURCE"),
    ],
)
@pytest.mark.parametrize("outcome", ["success", "failure", "cancel"])
async def test_write_path_streams_and_closes_handle(
    monkeypatch, tmp_path, provider_type, resource_id, space_type, outcome
):
    source = tmp_path / "content.bin"
    content = b"binary-content\x00" * (128 * 1024)
    source.write_bytes(content)
    streams = []
    read_sizes = []

    class BoundedReader(io.BufferedReader):
        def read(self, size=-1):
            assert 0 < size <= 1024 * 1024, "must read bounded chunks"
            read_sizes.append(size)
            return super().read(size)

    def open_source(path, mode="r", *args, **kwargs):
        assert path == source and mode == "rb"
        stream = BoundedReader(io.FileIO(path, "rb"))
        streams.append(stream)
        return stream

    def forbid_read_bytes(path):
        raise AssertionError(f"must not load the entire file: {path.name}")

    monkeypatch.setattr(Path, "open", open_source)
    monkeypatch.setattr(Path, "read_bytes", forbid_read_bytes)
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")

    async def transport(**kwargs):
        assert kwargs["method"] == "POST"
        assert kwargs["path"] == "/byaiService/fs/operation/v1/files/put"
        assert kwargs["headers"] == {
            "system-code": "BYCLAW-QA",
            "beyond-token": "test-token",
        }
        assert kwargs["data"]["spaceType"] == space_type
        expected_path = "/.bykc/KB001/raw/origin/content.bin"
        if resource_id:
            assert kwargs["data"]["resourceId"] == resource_id
            expected_path = f"/resource/kg_doc/KG_DOC_{resource_id}{expected_path}"
        assert kwargs["data"]["path"] == expected_path
        stream = kwargs["files"]["file"][1]
        assert stream is streams[0] and not stream.closed
        if outcome == "cancel":
            raise asyncio.CancelledError()
        if outcome == "failure":
            stream.read(1024)
            return {"status_code": 500, "data": {"msg": "upload failed"}}

        async def handle_request(request):
            body = await request.aread()
            assert content in body
            assert b'name="file"; filename="file"' in body
            return httpx.Response(200, json={})

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handle_request)
        ) as client:
            response = await client.post(
                "http://storage.test/files/put",
                data=kwargs["data"],
                files=kwargs["files"],
            )
        return {"status_code": response.status_code, "data": response.json()}

    headers = {"beyond-token": "test-token"}
    if resource_id:
        headers["X-Byclaw-Resource-Id"] = resource_id
    token = set_byclaw_userfs_headers(headers)
    location = StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/content.bin")
    provider = provider_type(transport=transport)
    try:
        if outcome == "success":
            stored = await provider.write(
                location, source, content_type="application/octet-stream"
            )
            assert stored.size == len(content)
            assert stored.location == location
            assert len(read_sizes) > 1
        else:
            error = (
                asyncio.CancelledError if outcome == "cancel" else StorageOperationError
            )
            with pytest.raises(error):
                await provider.write(
                    location, source, content_type="application/octet-stream"
                )
    finally:
        reset_byclaw_userfs_headers(token)
    assert streams and all(stream.closed for stream in streams)
    assert source.exists(), "provider must not delete caller-owned temporary files"
