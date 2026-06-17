from __future__ import annotations

import json as _json
from typing import Annotated, Any

from fastapi import APIRouter, Header, Request
from fastapi.responses import StreamingResponse
from kgw.dispatcher import dispatch_json
from kgw.dsl_guide import DSL_GUIDE_CONTENT
from kgw.envelope import CircuitOpen, KBNotFound, OperationNotSupported
from kgw.stream_proxy import proxy_download

router = APIRouter(prefix="/kgw/api/v1")


@router.post("/fileToMarkdownIndex")
async def file_to_markdown_index(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    file_path = str(body.get("filePath") or "")
    return await dispatch_json(
        request,
        operation="fileToMarkdownIndex",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
        file_path=file_path,
    )


@router.post("/fileBuildStatus")
async def file_build_status(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    return await dispatch_json(
        request,
        operation="fileBuildStatus",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )


@router.post("/listDir")
async def list_dir(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    return await dispatch_json(
        request,
        operation="listDir",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )


@router.post("/glob")
async def glob_files(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    return await dispatch_json(
        request,
        operation="glob",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )


@router.post("/readFile")
async def read_file(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    file_path = str(body.get("filePath") or "")
    return await dispatch_json(
        request,
        operation="readFile",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
        file_path=file_path,
    )


@router.get("/dslGuide")
async def dsl_guide() -> dict[str, Any]:
    """Return the static Agent DSL syntax reference guide."""
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"content": DSL_GUIDE_CONTENT},
    }


@router.post("/downloadFile")
async def download_file(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> StreamingResponse:
    """Stream-proxy an octet-stream download from the KB backend."""
    kn_code = str(body.get("knCode", ""))
    state = request.app.state

    config = await state.config_provider.get_kb_config(kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)
    if "downloadFile" not in config.operations:
        raise OperationNotSupported(
            f"downloadFile not supported by {kn_code}",
            kn_code=kn_code,
            operation="downloadFile",
        )

    cb = state.circuit_breakers.get(config.domain_url or config.domain_name)
    if not cb.before_call():
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=x_user_id
    )
    op_path = config.operation_path("downloadFile") or "/api/v1/downloadFile"

    # resolve_base_url handles both direct (domain_url) and
    # discovery (domain_name → Redis DiscoveryClient) modes.
    from kgw.upstream import resolve_base_url  # noqa: PLC0415

    base_url = await resolve_base_url(config)
    url = f"{base_url}{op_path}"

    backend_body = dict(body)
    backend_body["knCode"] = config.resource_code
    body_bytes = _json.dumps(backend_body).encode("utf-8")
    upstream_headers = dict(headers)
    upstream_headers.setdefault("Content-Type", "application/json")

    gen = proxy_download(
        url=url,
        upstream_headers=upstream_headers,
        http=state.http,
        body=body_bytes,
        kn_code=kn_code,
        operation="downloadFile",
    )

    try:
        first_chunk, fwd_headers = await gen.__anext__()
    except StopAsyncIteration:
        first_chunk, fwd_headers = b"", {}
    except Exception:
        cb.record_failure()
        raise

    async def _streamer():
        if first_chunk:
            yield first_chunk
        async for chunk, _ in gen:
            yield chunk

    media_type = fwd_headers.get("content-type", "application/octet-stream")
    response_headers = {}
    if "content-disposition" in fwd_headers:
        response_headers["Content-Disposition"] = fwd_headers["content-disposition"]
    if "content-length" in fwd_headers:
        response_headers["Content-Length"] = fwd_headers["content-length"]

    cb.record_success()

    return StreamingResponse(
        _streamer(), media_type=media_type, headers=response_headers
    )
