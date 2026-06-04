"""Streaming proxy for multipart uploads and octet-stream downloads.

proxy_upload  — forwards a multipart file upload chunk by chunk to the KB
                backend without buffering the full file in RAM.
proxy_download — streams a binary download response back to the caller via
                 an async generator of (bytes, forward_headers) pairs.

Both raise KgwError subclasses on failure; callers should let them propagate
to the FastAPI exception handler in main.py.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
from kgw.envelope import BackendAuthFailed, DownloadStreamBroken, UploadStreamBroken
from kgw.observability.logger import get_logger
from kgw.observability.metrics import STREAM_BYTES_TOTAL

_log = get_logger(__name__)
_CHUNK = 64 * 1024  # 64 KB read chunk for seek-based byte counting


async def proxy_upload(
    *,
    url: str,
    upstream_headers: dict[str, str],
    http: httpx.AsyncClient,
    form_fields: dict[str, str],
    upload_file: Any,  # FastAPI UploadFile (has .filename, .content_type, .file)
    kn_code: str,
    operation: str,
) -> dict[str, Any]:
    """Stream-forward a multipart upload to the KB backend.

    httpx reads the SpooledTemporaryFile in chunks internally — memory peak
    is bounded by httpx's buffer (~16 KB), not the total file size.
    Raises UploadStreamBroken on any I/O error; BackendAuthFailed on 401/403.
    """
    files = {
        "fileContent": (
            upload_file.filename or "file",
            upload_file.file,
            upload_file.content_type or "application/octet-stream",
        )
    }
    try:
        resp_ctx = http.stream(
            "POST",
            url,
            headers=upstream_headers,
            data=form_fields,
            files=files,
        )
        async with resp_ctx as resp:
            status = resp.status_code
            body = await resp.aread()
    except (httpx.TimeoutException, httpx.StreamError, httpx.ReadError) as exc:
        raise UploadStreamBroken(
            f"upload stream broken: {url}", kn_code=kn_code
        ) from exc

    if status in (401, 403):
        raise BackendAuthFailed(
            f"backend auth failed uploading to {url}", kn_code=kn_code
        )

    # Count bytes for STREAM_BYTES_TOTAL metric (seek-based on SpooledTemporaryFile)
    try:
        upload_file.file.seek(0, 2)
        byte_count = upload_file.file.tell()
        STREAM_BYTES_TOTAL.labels(
            direction="upload", operation=operation, kn_code=kn_code
        ).inc(byte_count)
    except Exception:  # noqa: BLE001
        pass

    return json.loads(body)


async def proxy_download(
    *,
    url: str,
    upstream_headers: dict[str, str],
    http: httpx.AsyncClient,
    body: bytes,
    kn_code: str,
    operation: str,
) -> AsyncIterator[tuple[bytes, dict[str, str]]]:
    """Async-generator that streams a download response back to the caller.

    Yields ``(chunk, forward_headers)`` pairs. The first yield includes the
    response headers (Content-Disposition, Content-Type, Content-Length);
    subsequent yields carry empty headers.

    Raises BackendAuthFailed on 401/403, DownloadStreamBroken on I/O error.
    Caller wraps this in a FastAPI StreamingResponse.
    """
    req = http.build_request("POST", url, headers=upstream_headers, content=body)
    resp = await http.send(req, stream=True)
    if resp.status_code in (401, 403):
        await resp.aclose()
        raise BackendAuthFailed(
            f"backend auth failed downloading from {url}", kn_code=kn_code
        )

    fwd = {
        k: resp.headers[k]
        for k in ("content-disposition", "content-type", "content-length")
        if k in resp.headers
    }
    byte_count = 0
    first = True
    try:
        async for chunk in resp.aiter_bytes(_CHUNK):
            byte_count += len(chunk)
            yield chunk, (fwd if first else {})
            first = False
    except httpx.StreamError as exc:
        raise DownloadStreamBroken(f"download broken: {url}", kn_code=kn_code) from exc
    finally:
        await resp.aclose()
        STREAM_BYTES_TOTAL.labels(
            direction="download", operation=operation, kn_code=kn_code
        ).inc(byte_count)
