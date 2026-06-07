"""End-to-end smoke test for the /kgw/internal/v1/echo endpoint.

Tests the full request chain:
  app.state.config_provider → auth_provider → httpx → audit

Uses unittest.mock to patch KbConfigProvider and AuthProvider,
and respx to intercept httpx calls to the upstream KB.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import respx
from httpx import ASGITransport, AsyncClient


def _mock_settings(monkeypatch):
    from kgw.settings import get_settings

    mock_s = MagicMock()
    mock_s.db_dsn = "postgresql://u:p@h:5432/db"
    mock_s.db_pool_min_size = 1
    mock_s.db_pool_max_size = 2
    mock_s.redis_url = "redis://localhost:6379/0"
    mock_s.http_default_timeout_seconds = 5.0
    mock_s.http_pool_max_connections = 10
    mock_s.http_pool_max_keepalive = 5
    mock_s.file_storage_minio_host = "minio"
    mock_s.file_storage_minio_api_port = 9000
    mock_s.file_storage_minio_secure = False
    mock_s.minio_access_key = "ak"
    mock_s.minio_secret_key = "sk"
    mock_s.minio_bucket = "byclaw"
    mock_s.minio_kg_doc_prefix = "resource/doc/KG_DOC_"
    mock_s.redis_auth_key_template = "user:{user_code}:login:auth"
    mock_s.audit_queue_max_size = 100
    mock_s.circuit_failure_threshold = 5
    mock_s.circuit_open_duration = 60
    mock_s.ingest_concurrency_limit = 10
    get_settings.cache_clear()
    monkeypatch.setattr("kgw.main.get_settings", lambda: mock_s)
    return mock_s


def _build_app_with_mocked_infra(monkeypatch, *, config_provider, auth_provider):
    """Build a testable app with all infra mocked except config/auth providers."""
    mock_pool = AsyncMock()
    mock_pool.close = AsyncMock()

    mock_redis = AsyncMock()
    mock_redis.aclose = AsyncMock()

    mock_audit = AsyncMock()
    mock_audit.start = AsyncMock()
    mock_audit.stop = AsyncMock()
    mock_audit.record = AsyncMock()
    mock_audit.flush = AsyncMock()

    monkeypatch.setattr("kgw.main.build_pool", AsyncMock(return_value=mock_pool))
    monkeypatch.setattr("kgw.main.run_migrations", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        "kgw.main.redis_async.from_url", MagicMock(return_value=mock_redis)
    )
    monkeypatch.setattr(
        "kgw.main.KbConfigProvider", MagicMock(return_value=config_provider)
    )
    monkeypatch.setattr("kgw.main.AuthProvider", MagicMock(return_value=auth_provider))
    monkeypatch.setattr("kgw.main.AuditWriter", MagicMock(return_value=mock_audit))

    from kgw.main import build_app

    app = build_app()
    return app, mock_audit


def _make_kb_config(kn_code: str, domain_url: str, headers: dict):
    from kgw.config_provider import KbConfig

    return KbConfig(
        kn_code=kn_code,
        resource_code=kn_code,
        domain_url=domain_url,
        domain_name="",
        headers=headers,
        operations=frozenset(["knowledgeSearch"]),
        operation_paths={"knowledgeSearch": "/api/v1/knowledgeItems/search"},
        raw={},
    )


@respx.mock
async def test_echo_happy_path(monkeypatch):
    """Full chain: config → auth → httpx upstream → audit record."""
    _mock_settings(monkeypatch)

    kb_config = _make_kb_config(
        "hr_policy",
        "http://upstream.test",
        {"Authorization": "${Authorization}"},
    )
    mock_config_provider = AsyncMock()
    mock_config_provider.get_kb_config = AsyncMock(return_value=kb_config)

    mock_auth_provider = AsyncMock()
    mock_auth_provider.resolve_headers = AsyncMock(
        return_value={"Authorization": "Bearer token-xyz"}
    )

    upstream_route = respx.get("http://upstream.test/healthz").mock(
        return_value=httpx.Response(200, json={"upstream": "ok"})
    )

    app, mock_audit = _build_app_with_mocked_infra(
        monkeypatch,
        config_provider=mock_config_provider,
        auth_provider=mock_auth_provider,
    )

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post(
                "/kgw/internal/v1/echo",
                headers={"X-User-Id": "user_0001", "X-Trace-Id": "trace-smoke"},
                json={"knCode": "hr_policy"},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["knCode"] == "hr_policy"
    assert body["resultObject"]["upstreamStatus"] == 200
    assert resp.headers.get("X-Trace-Id") == "trace-smoke"

    # Upstream received substituted auth header
    up_req = upstream_route.calls.last.request
    assert up_req.headers["Authorization"] == "Bearer token-xyz"
    assert up_req.headers["X-Trace-Id"] == "trace-smoke"

    # Audit was called with correct fields
    mock_audit.record.assert_called_once()
    audit_entry = mock_audit.record.call_args[0][0]
    assert audit_entry.source == "serve"
    assert audit_entry.operation_type == "echo"
    assert audit_entry.kn_code == "hr_policy"
    assert audit_entry.actor_user_id == "user_0001"
    assert audit_entry.trace_id == "trace-smoke"
    assert audit_entry.result_code == "0"


@respx.mock
async def test_echo_returns_kb_not_found(monkeypatch):
    """KBNotFound returned when config_provider returns None."""
    _mock_settings(monkeypatch)

    mock_config_provider = AsyncMock()
    mock_config_provider.get_kb_config = AsyncMock(return_value=None)

    mock_auth_provider = AsyncMock()

    app, _ = _build_app_with_mocked_infra(
        monkeypatch,
        config_provider=mock_config_provider,
        auth_provider=mock_auth_provider,
    )

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post(
                "/kgw/internal/v1/echo",
                headers={"X-User-Id": "user_0001"},
                json={"knCode": "ghost_kb"},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "KBNotFound"
    assert body["resultObject"]["knCode"] == "ghost_kb"


@respx.mock
async def test_echo_returns_auth_info_not_found(monkeypatch):
    """AuthInfoNotFound returned when auth hash missing in Redis."""
    _mock_settings(monkeypatch)

    from kgw.envelope import AuthInfoNotFound

    kb_config = _make_kb_config(
        "auth_kb",
        "http://upstream.test",
        {"Authorization": "${Authorization}"},
    )
    mock_config_provider = AsyncMock()
    mock_config_provider.get_kb_config = AsyncMock(return_value=kb_config)

    mock_auth_provider = AsyncMock()
    mock_auth_provider.resolve_headers = AsyncMock(
        side_effect=AuthInfoNotFound("auth missing", user_code="user_no_auth")
    )

    app, _ = _build_app_with_mocked_infra(
        monkeypatch,
        config_provider=mock_config_provider,
        auth_provider=mock_auth_provider,
    )

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post(
                "/kgw/internal/v1/echo",
                headers={"X-User-Id": "user_no_auth"},
                json={"knCode": "auth_kb"},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "AuthInfoNotFound"


async def test_echo_missing_kn_code_returns_error(monkeypatch):
    """Empty knCode returns KBNotFound immediately."""
    _mock_settings(monkeypatch)

    mock_config_provider = AsyncMock()
    mock_auth_provider = AsyncMock()

    app, _ = _build_app_with_mocked_infra(
        monkeypatch,
        config_provider=mock_config_provider,
        auth_provider=mock_auth_provider,
    )

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post(
                "/kgw/internal/v1/echo",
                headers={"X-User-Id": "user_0001"},
                json={},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "KBNotFound"
