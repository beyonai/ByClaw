"""Tests for FastAPI app lifecycle and basic endpoints.

Unit tests mock all infrastructure (no real DB/Redis/MinIO).
Integration tests use real backends via .env fixtures.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient


def _mock_settings(monkeypatch):
    """Patch get_settings to return a minimal Settings-like object."""
    from kgw.settings import get_settings

    mock_s = MagicMock()
    mock_s.db_dsn = "postgresql://u:p@h:5432/db"
    mock_s.db_pool_min_size = 1
    mock_s.db_pool_max_size = 2
    mock_s.redis_url = "redis://localhost:6379/0"
    mock_s.http_default_timeout_seconds = 5.0
    mock_s.http_pool_max_connections = 10
    mock_s.http_pool_max_keepalive = 5
    mock_s.redis_auth_key_template = "user:{user_code}:login:auth"
    mock_s.audit_queue_max_size = 100
    mock_s.circuit_failure_threshold = 5
    mock_s.circuit_open_duration = 60
    mock_s.ingest_concurrency_limit = 10

    get_settings.cache_clear()
    monkeypatch.setattr("kgw.main.get_settings", lambda: mock_s)
    return mock_s


@pytest.fixture
def mock_infra(monkeypatch):
    """Patch all infrastructure in main.py to avoid real connections."""
    mock_pool = AsyncMock()
    mock_pool.connection = MagicMock(
        return_value=AsyncMock(
            __aenter__=AsyncMock(return_value=AsyncMock()),
            __aexit__=AsyncMock(return_value=None),
        )
    )
    mock_pool.close = AsyncMock()

    mock_redis = AsyncMock()
    mock_redis.aclose = AsyncMock()

    mock_http = AsyncMock()
    mock_http.aclose = AsyncMock()

    mock_audit = AsyncMock()
    mock_audit.start = AsyncMock()
    mock_audit.stop = AsyncMock()

    monkeypatch.setattr("kgw.main.build_pool", AsyncMock(return_value=mock_pool))
    monkeypatch.setattr("kgw.main.run_migrations", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        "kgw.main.redis_async.from_url", MagicMock(return_value=mock_redis)
    )
    monkeypatch.setattr("kgw.main.build_http_client", MagicMock(return_value=mock_http))
    monkeypatch.setattr(
        "kgw.main.KbConfigProvider", MagicMock(return_value=AsyncMock())
    )
    monkeypatch.setattr("kgw.main.AuthProvider", MagicMock(return_value=AsyncMock()))
    monkeypatch.setattr("kgw.main.AuditWriter", MagicMock(return_value=mock_audit))
    return mock_pool


async def test_healthz_returns_ok(monkeypatch, mock_infra):  # pylint: disable=redefined-outer-name,unused-argument
    _mock_settings(monkeypatch)

    from kgw.main import build_app

    app = build_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_metrics_endpoint_serves_prometheus_text(monkeypatch, mock_infra):  # pylint: disable=redefined-outer-name,unused-argument
    _mock_settings(monkeypatch)

    from kgw.main import build_app

    app = build_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.get("/metrics")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]


async def test_kgw_error_handler_returns_envelope(monkeypatch, mock_infra):  # pylint: disable=redefined-outer-name,unused-argument
    """KgwError raised in a handler must produce a 200 JSON envelope."""
    from fastapi import APIRouter
    from kgw.envelope import KBNotFound
    from kgw.main import build_app

    _mock_settings(monkeypatch)
    app = build_app()

    test_router = APIRouter()

    @test_router.get("/__test_kbnotfound")
    async def _():
        raise KBNotFound("no such kb", kn_code="ghost")

    app.include_router(test_router)

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.get("/__test_kbnotfound")

    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "KBNotFound"
    assert body["resultObject"]["knCode"] == "ghost"


async def test_trace_id_propagated_in_response(monkeypatch, mock_infra):  # pylint: disable=redefined-outer-name,unused-argument
    """TraceIdMiddleware must echo X-Trace-Id in responses."""
    _mock_settings(monkeypatch)

    from kgw.main import build_app

    app = build_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.get("/healthz", headers={"X-Trace-Id": "my-trace"})
    assert resp.headers.get("X-Trace-Id") == "my-trace"
