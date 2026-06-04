"""Unit tests for stream_proxy: upload and download passthrough."""

from __future__ import annotations

import io
from unittest.mock import MagicMock

import httpx
import pytest
import respx
from kgw.envelope import BackendAuthFailed, UploadStreamBroken
from kgw.stream_proxy import proxy_download, proxy_upload


def _make_upload_file(
    content: bytes, filename: str = "test.pdf", content_type: str = "application/pdf"
):
    f = MagicMock()
    f.filename = filename
    f.content_type = content_type
    f.file = io.BytesIO(content)
    return f


@pytest.mark.asyncio
async def test_proxy_upload_success():
    with respx.mock:
        respx.post("http://kb.test/api/v1/knowledgeItems/import").mock(
            return_value=httpx.Response(
                200,
                json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}},
            )
        )
        async with httpx.AsyncClient() as http:
            upload = _make_upload_file(b"hello world")
            result = await proxy_upload(
                url="http://kb.test/api/v1/knowledgeItems/import",
                upstream_headers={"Authorization": "Bearer tok"},
                http=http,
                form_fields={"knCode": "kb1", "filePath": "/test.pdf"},
                upload_file=upload,
                kn_code="kb1",
                operation="fileImport",
            )
    assert result["resultCode"] == "0"


@pytest.mark.asyncio
async def test_proxy_upload_401_raises_backend_auth_failed():
    with respx.mock:
        respx.post("http://kb.test/api/v1/knowledgeItems/import").mock(
            return_value=httpx.Response(401)
        )
        async with httpx.AsyncClient() as http:
            upload = _make_upload_file(b"data")
            with pytest.raises(BackendAuthFailed):
                await proxy_upload(
                    url="http://kb.test/api/v1/knowledgeItems/import",
                    upstream_headers={},
                    http=http,
                    form_fields={},
                    upload_file=upload,
                    kn_code="kb1",
                    operation="fileImport",
                )


@pytest.mark.asyncio
async def test_proxy_upload_stream_broken_on_connect_error():
    with respx.mock:
        respx.post("http://kb.test/api/v1/knowledgeItems/import").mock(
            side_effect=httpx.ReadError("broken pipe", request=MagicMock())
        )
        async with httpx.AsyncClient() as http:
            upload = _make_upload_file(b"data")
            with pytest.raises(UploadStreamBroken):
                await proxy_upload(
                    url="http://kb.test/api/v1/knowledgeItems/import",
                    upstream_headers={},
                    http=http,
                    form_fields={},
                    upload_file=upload,
                    kn_code="kb1",
                    operation="fileImport",
                )


@pytest.mark.asyncio
async def test_proxy_download_streams_bytes():
    body_bytes = b"binary content here"
    with respx.mock:
        respx.post("http://kb.test/api/v1/downloadFile").mock(
            return_value=httpx.Response(
                200,
                content=body_bytes,
                headers={"content-disposition": "attachment; filename=file.pdf"},
            )
        )
        async with httpx.AsyncClient() as http:
            chunks = []
            fwd_headers = {}
            first = True
            async for chunk, hdrs in proxy_download(
                url="http://kb.test/api/v1/downloadFile",
                upstream_headers={},
                http=http,
                body=b'{"knCode":"kb1","filePath":"/file.pdf"}',
                kn_code="kb1",
                operation="downloadFile",
            ):
                chunks.append(chunk)
                if first:
                    fwd_headers = hdrs
                    first = False
    assert b"".join(chunks) == body_bytes
    assert "content-disposition" in fwd_headers


@pytest.mark.asyncio
async def test_proxy_download_401_raises_backend_auth_failed():
    with respx.mock:
        respx.post("http://kb.test/api/v1/downloadFile").mock(
            return_value=httpx.Response(401)
        )
        async with httpx.AsyncClient() as http:
            with pytest.raises(BackendAuthFailed):
                async for _ in proxy_download(
                    url="http://kb.test/api/v1/downloadFile",
                    upstream_headers={},
                    http=http,
                    body=b"{}",
                    kn_code="kb1",
                    operation="downloadFile",
                ):
                    pass
