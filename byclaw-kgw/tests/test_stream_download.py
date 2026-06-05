"""Unit tests for /downloadFile streaming endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import respx
from fastapi import FastAPI
from httpx import ASGITransport
from kgw.config_provider import KbConfig
from kgw.envelope import KgwError
from kgw.resilience.circuit_breaker import CircuitBreakerRegistry

_KB = KbConfig(
    kn_code="kb_dl",
    resource_code="backend_dl_1",
    domain_url="http://kb-dl.test",
    domain_name="",
    headers={},
    operations=frozenset({"downloadFile"}),
    operation_paths={"downloadFile": "/api/v1/downloadFile"},
    raw={},
)


def _build_app():
    from fastapi import Request
    from fastapi.responses import JSONResponse
    from kgw.api.files import router

    app = FastAPI()

    @app.exception_handler(KgwError)
    async def _kgw_handler(request: Request, exc: KgwError):  # pylint: disable=unused-argument
        return JSONResponse(status_code=200, content=exc.to_envelope())

    app.include_router(router)

    state = MagicMock()
    state.config_provider = AsyncMock()
    state.config_provider.get_kb_config.return_value = _KB
    state.auth_provider = AsyncMock()
    state.auth_provider.resolve_headers.return_value = {}
    state.circuit_breakers = CircuitBreakerRegistry()
    state.audit = AsyncMock()
    state.http = httpx.AsyncClient()
    app.state.config_provider = state.config_provider
    app.state.auth_provider = state.auth_provider
    app.state.circuit_breakers = state.circuit_breakers
    app.state.audit = state.audit
    app.state.http = state.http
    return app, state


@pytest.mark.asyncio
async def test_download_file_streams_bytes():
    """Successful download yields bytes from upstream octet-stream."""
    app, state = _build_app()
    payload = b"x" * (256 * 1024)  # 256 KB
    with respx.mock:
        respx.post("http://kb-dl.test/api/v1/downloadFile").mock(
            return_value=httpx.Response(
                200,
                content=payload,
                headers={
                    "content-type": "application/octet-stream",
                    "content-disposition": 'attachment; filename="a.pdf"',
                },
            )
        )
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/kgw/api/v1/downloadFile",
                json={"knCode": "kb_dl", "filePath": "/a.pdf"},
                headers={"X-User-Id": "u1"},
            )
    assert resp.status_code == 200
    assert resp.content == payload
    assert "attachment" in resp.headers.get("content-disposition", "")
    await state.http.aclose()


@pytest.mark.asyncio
async def test_download_file_kb_not_found():
    """Unknown knCode returns KBNotFound envelope."""
    app, state = _build_app()
    state.config_provider.get_kb_config.return_value = None
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/kgw/api/v1/downloadFile",
            json={"knCode": "missing", "filePath": "/x"},
            headers={"X-User-Id": "u1"},
        )
    assert resp.status_code == 200
    assert resp.json()["resultObject"]["errorCode"] == "KBNotFound"
    await state.http.aclose()


@pytest.mark.asyncio
async def test_download_file_circuit_open():
    """Circuit OPEN returns CircuitOpen envelope, no backend call."""
    app, state = _build_app()
    cb = state.circuit_breakers.get("http://kb-dl.test")
    for _ in range(5):
        cb.before_call()
        cb.record_failure()
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/kgw/api/v1/downloadFile",
            json={"knCode": "kb_dl", "filePath": "/x"},
            headers={"X-User-Id": "u1"},
        )
    assert resp.status_code == 200
    assert resp.json()["resultObject"]["errorCode"] == "CircuitOpen"
    await state.http.aclose()


@pytest.mark.asyncio
async def test_download_file_resource_code_substituted():
    """Backend receives resource_code, not portal kn_code."""
    app, state = _build_app()
    captured: dict = {}
    with respx.mock:

        def _capture(request):
            import json as _json

            captured.update(_json.loads(request.content))
            return httpx.Response(
                200,
                content=b"ok",
                headers={"content-type": "application/octet-stream"},
            )

        respx.post("http://kb-dl.test/api/v1/downloadFile").mock(side_effect=_capture)
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await client.post(
                "/kgw/api/v1/downloadFile",
                json={"knCode": "kb_dl", "filePath": "/x"},
                headers={"X-User-Id": "u1"},
            )
    assert captured.get("knCode") == "backend_dl_1"
    await state.http.aclose()


@pytest.mark.asyncio
async def test_download_file_backend_auth_failure_records_breaker():
    """BackendAuthFailed (401) must call cb.record_failure() so the breaker can trip."""
    app, state = _build_app()
    with respx.mock:
        respx.post("http://kb-dl.test/api/v1/downloadFile").mock(
            return_value=httpx.Response(401)
        )
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/kgw/api/v1/downloadFile",
                json={"knCode": "kb_dl", "filePath": "/x"},
                headers={"X-User-Id": "u1"},
            )
    assert resp.status_code == 200
    assert resp.json()["resultObject"]["errorCode"] == "BackendAuthFailed"
    cb = state.circuit_breakers.get("http://kb-dl.test")
    assert cb._failure_count > 0
    await state.http.aclose()
