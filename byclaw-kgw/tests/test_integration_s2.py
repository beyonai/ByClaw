"""S2 integration tests.

Require real OpenGauss + Redis from .env.
Run: uv run pytest -m integration tests/test_integration_s2.py -v
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
import redis.asyncio as redis_async
import respx
from httpx import ASGITransport

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# --- KB config seeded into MinIO for all S2 integration tests ---
_KN_CODE = "test_kb_s2"
_RESOURCE_CODE = "backend_s2_1"
_KB_CONFIG = {
    "resourceCode": _RESOURCE_CODE,
    "domainName": "kb-mock-service",
    "domainURL": "http://kb-s2-mock.internal",
    "headers": {},
    "resourceService": [
        {"name": "directoryCreate", "path": "/api/v1/directories/create"},
        {"name": "directoryDelete", "path": "/api/v1/directories/delete"},
        {"name": "fileImport", "path": "/api/v1/knowledgeItems/import"},
        {"name": "fileDelete", "path": "/api/v1/knowledgeItems/delete"},
        {"name": "buildTrigger", "path": "/api/v1/fileToMarkdownIndex"},
        {"name": "buildStatus", "path": "/api/v1/fileBuildStatus"},
    ],
}
_KB_MINIO_KEY = f"resource/doc/KG_DOC_{_KN_CODE}.json"


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def s2_client(pg_dsn, redis_url, minio_settings) -> AsyncIterator:  # pylint: disable=unused-argument,redefined-outer-name
    """Full app with real DB + Redis, KB config seeded in MinIO, KB backend mocked.

    Manually wires app.state instead of using lifespan to avoid connection
    issues in background test environments.

    Key rule: every aioboto3 Session is created AND fully closed within a single
    async-with block — never stored across a yield boundary (S1 integration
    test pattern).
    """
    from pathlib import Path

    import aioboto3
    from kgw.audit import AuditWriter
    from kgw.auth_provider import AuthProvider
    from kgw.config_provider import KbConfigProvider
    from kgw.db import build_pool, run_migrations
    from kgw.http_client import build_http_client
    from kgw.main import build_app
    from kgw.resilience.circuit_breaker import CircuitBreakerRegistry
    from kgw.settings import get_settings

    sql_dir = Path(__file__).resolve().parent.parent / "sql"
    get_settings.cache_clear()
    settings = get_settings()
    bucket = minio_settings["bucket"]

    # Seed KB config — new Session, fully closed before yield
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        await s3.put_object(
            Bucket=bucket,
            Key=_KB_MINIO_KEY,
            Body=json.dumps(_KB_CONFIG).encode(),
            ContentType="application/json",
        )

    pool = await build_pool(pg_dsn, min_size=1, max_size=5)
    await run_migrations(pool, sql_dir)

    redis_client = redis_async.from_url(redis_url, decode_responses=False)
    http_client = build_http_client(
        timeout_seconds=10.0, max_connections=20, max_keepalive=5
    )

    scheme = "https" if settings.file_storage_minio_secure else "http"
    minio_ep = f"{scheme}://{settings.file_storage_minio_host}:{settings.file_storage_minio_api_port}"
    config_provider = KbConfigProvider(
        endpoint_url=minio_ep,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        bucket=settings.minio_bucket,
        prefix=settings.minio_kg_doc_prefix,
    )
    auth_provider = AuthProvider(
        redis_client, key_template=settings.redis_auth_key_template
    )
    audit_writer = AuditWriter(pool, queue_max_size=1000)
    await audit_writer.start()
    circuit_breakers = CircuitBreakerRegistry(failure_threshold=5, open_duration=30.0)

    app = build_app()
    app.state.settings = settings
    app.state.pool = pool
    app.state.redis = redis_client
    app.state.http = http_client
    app.state.config_provider = config_provider
    app.state.auth_provider = auth_provider
    app.state.audit = audit_writer
    app.state.circuit_breakers = circuit_breakers

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client

    await audit_writer.stop()
    await http_client.aclose()
    await redis_client.aclose()
    await pool.close()

    # Cleanup — new Session, fully closed within this block
    try:
        async with aioboto3.Session().client(
            "s3",
            endpoint_url=minio_settings["endpoint_url"],
            aws_access_key_id=minio_settings["access_key"],
            aws_secret_access_key=minio_settings["secret_key"],
        ) as s3:
            await s3.delete_object(Bucket=bucket, Key=_KB_MINIO_KEY)
    except Exception:  # noqa: BLE001
        pass


async def test_directory_create_returns_ok(s2_client):  # pylint: disable=redefined-outer-name
    """directoryCreate proxied to mocked KB -> returns KB response."""
    with respx.mock(assert_all_called=False) as mock_router:
        mock_router.post("http://kb-s2-mock.internal/api/v1/directories/create").mock(
            return_value=httpx.Response(
                200,
                json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}},
            )
        )
        resp = await s2_client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_CODE, "directoryPath": "/s2-integration-test"},
            headers={"X-User-Id": "s2_test_user"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["resultCode"] == "0"


async def test_resource_code_substituted_in_upstream_body(s2_client):  # pylint: disable=redefined-outer-name
    """Dispatcher substitutes portal knCode with backend resource_code in KB request body."""
    captured_body: dict = {}
    with respx.mock(assert_all_called=False) as mock_router:

        def _capture(request):
            captured_body.update(json.loads(request.content))
            return httpx.Response(
                200, json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
            )

        mock_router.post("http://kb-s2-mock.internal/api/v1/directories/create").mock(
            side_effect=_capture
        )
        await s2_client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_CODE, "directoryPath": "/check-resource-code"},
            headers={"X-User-Id": "s2_test_user"},
        )
    assert captured_body.get("knCode") == _RESOURCE_CODE


async def test_circuit_breaker_opens_after_5_failures(s2_client):  # pylint: disable=redefined-outer-name
    """5 consecutive UpstreamConnectError -> CircuitOpen on 6th call."""
    # Use a separate kn_code config so this test's CB state doesn't affect others.
    # We'll reuse the same config but expect the CB to be fresh if tests run in order.
    # Note: s2_client fixture is module-scoped so CB state persists across tests.
    # For this test we intentionally cause failures on directoryDelete (not used by other tests).
    with respx.mock(assert_all_called=False) as mock_router:
        mock_router.post("http://kb-s2-mock.internal/api/v1/directories/delete").mock(
            side_effect=httpx.ConnectError("simulated down")
        )
        for _ in range(5):
            resp = await s2_client.post(
                "/kgw/api/v1/directories/delete",
                json={"knCode": _KN_CODE},
                headers={"X-User-Id": "s2_test_user"},
            )
            assert resp.json()["resultObject"]["errorCode"] == "UpstreamConnectError"

        # 6th call: circuit is OPEN -- no backend call, returns CircuitOpen
        resp = await s2_client.post(
            "/kgw/api/v1/directories/delete",
            json={"knCode": _KN_CODE},
            headers={"X-User-Id": "s2_test_user"},
        )
        assert resp.json()["resultObject"]["errorCode"] == "CircuitOpen"


async def test_kb_not_found_when_config_missing(s2_client):  # pylint: disable=redefined-outer-name
    """knCode with no MinIO config -> KBNotFound envelope."""
    resp = await s2_client.post(
        "/kgw/api/v1/directories/create",
        json={"knCode": "nonexistent_kb_xyz"},
        headers={"X-User-Id": "s2_test_user"},
    )
    assert resp.status_code == 200
    assert resp.json()["resultObject"]["errorCode"] == "KBNotFound"


# ---- Task 10: by-framework discovery mode integration test ----


async def test_dispatch_via_discovery_mode(redis_url):
    """Full discovery-mode integration test.

    Registers a service instance in real Redis, then calls _call_via_discovery.
    The DiscoveryClient reads from Redis (real) to resolve the instance.
    The HTTP call to the resolved instance is intercepted by patching
    httpx.AsyncClient.request (which ByHttpClient uses internally).
    This verifies the complete path:
      Redis registration → DiscoveryClient.discover → URL construction → HTTP POST
    """
    from unittest.mock import MagicMock, patch

    service_name = "test-kb-discovery-svc-s2"
    instance_id = f"{service_name}:test-instance"
    mock_host = "127.0.0.1"
    mock_port = 18999

    instance_json = json.dumps(
        {
            "id": instance_id,
            "host": mock_host,
            "port": mock_port,
            "protocol": "http",
            "path_prefix": None,
            "weight": 1,
            "metadata": {},
        }
    )
    now_ms = int(time.time() * 1000)
    hash_key = f"byai_gateway:sd:instances:{service_name}"
    zset_key = f"byai_gateway:sd:active:{service_name}"
    svc_index_key = "byai_gateway:sd:services"

    r = redis_async.from_url(redis_url, decode_responses=True)
    await r.hset(hash_key, instance_id, instance_json)
    await r.zadd(zset_key, {instance_id: now_ms})
    await r.sadd(svc_index_key, service_name)

    try:
        from kgw.upstream import call_via_discovery

        # Mock httpx.AsyncClient.request — ByHttpClient uses it internally.
        # We capture the URL and body, and return a valid JSON response.
        captured: dict = {}

        async def _mock_request(self_client, method, url, **kwargs):  # pylint: disable=unused-argument
            captured["url"] = url
            captured["body"] = kwargs.get("json", {})
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.is_success = True
            mock_resp.headers = httpx.Headers({"content-type": "application/json"})
            mock_resp.json = MagicMock(
                return_value={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
            )
            mock_resp.text = '{"resultCode":"0","resultMsg":"ok","resultObject":{}}'
            return mock_resp

        with patch("httpx.AsyncClient.request", new=_mock_request):
            result = await call_via_discovery(
                domain_name=service_name,
                op_path="/api/v1/directories/create",
                body={"knCode": "backend_kb_x", "directoryPath": "/discovery-test"},
                headers={},
            )

        assert result["resultCode"] == "0"
        # Verify DiscoveryClient resolved to the right host:port
        assert (
            captured.get("url")
            == f"http://{mock_host}:{mock_port}/api/v1/directories/create"
        )
        assert captured.get("body", {}).get("knCode") == "backend_kb_x"

    finally:
        await r.delete(hash_key, zset_key)
        await r.srem(svc_index_key, service_name)
        await r.aclose()
