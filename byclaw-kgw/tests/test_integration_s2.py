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

pytestmark = pytest.mark.integration

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


@pytest_asyncio.fixture(scope="module")
async def s2_client(pg_dsn, redis_url, minio_settings, minio_bucket) -> AsyncIterator:  # pylint: disable=unused-argument,redefined-outer-name
    """Full app with real DB + Redis, KB config seeded in MinIO, KB backend mocked."""
    import aioboto3

    # Seed KB config into MinIO
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        await s3.put_object(
            Bucket=minio_bucket,
            Key=_KB_MINIO_KEY,
            Body=json.dumps(_KB_CONFIG).encode(),
            ContentType="application/json",
        )

    from kgw.main import build_app
    from kgw.settings import get_settings

    # Force settings to re-read from .env (lru_cache may be stale)
    get_settings.cache_clear()
    app = build_app()

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client

    # Cleanup MinIO object
    try:
        async with session.client(
            "s3",
            endpoint_url=minio_settings["endpoint_url"],
            aws_access_key_id=minio_settings["access_key"],
            aws_secret_access_key=minio_settings["secret_key"],
        ) as s3:
            await s3.delete_object(Bucket=minio_bucket, Key=_KB_MINIO_KEY)
    except Exception:  # noqa: BLE001
        pass


@pytest.mark.asyncio
async def test_directory_create_returns_ok(s2_client):  # pylint: disable=redefined-outer-name
    """directoryCreate proxied to mocked KB -> returns KB response."""
    with respx.mock(assert_all_called=False):
        respx.post("http://kb-s2-mock.internal/api/v1/directories/create").mock(
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


@pytest.mark.asyncio
async def test_resource_code_substituted_in_upstream_body(s2_client):  # pylint: disable=redefined-outer-name
    """Dispatcher substitutes portal knCode with backend resource_code in KB request body."""
    captured_body: dict = {}
    with respx.mock(assert_all_called=False):

        def _capture(request):
            captured_body.update(json.loads(request.content))
            return httpx.Response(
                200, json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
            )

        respx.post("http://kb-s2-mock.internal/api/v1/directories/create").mock(
            side_effect=_capture
        )
        await s2_client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_CODE, "directoryPath": "/check-resource-code"},
            headers={"X-User-Id": "s2_test_user"},
        )
    assert captured_body.get("knCode") == _RESOURCE_CODE


@pytest.mark.asyncio
async def test_circuit_breaker_opens_after_5_failures(s2_client):  # pylint: disable=redefined-outer-name
    """5 consecutive UpstreamConnectError -> CircuitOpen on 6th call."""
    # Use a separate kn_code config so this test's CB state doesn't affect others.
    # We'll reuse the same config but expect the CB to be fresh if tests run in order.
    # Note: s2_client fixture is module-scoped so CB state persists across tests.
    # For this test we intentionally cause failures on directoryDelete (not used by other tests).
    with respx.mock(assert_all_called=False):
        respx.post("http://kb-s2-mock.internal/api/v1/directories/delete").mock(
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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_dispatch_via_discovery_mode(redis_url):
    """
    Verify discovery-mode dispatch:
    1. Start a local aiohttp HTTP server (mock KB backend)
    2. Register it in Redis using by-framework key format
    3. Call _call_via_discovery -- verify request reaches mock server
    """
    from aiohttp import web

    # Step A: Start mock KB server
    received: list[dict] = []

    async def handle(request):
        body = await request.json()
        received.append(body)
        return web.json_response(
            {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        )

    aio_app = web.Application()
    aio_app.router.add_post("/api/v1/directories/create", handle)
    runner = web.AppRunner(aio_app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)  # OS assigns free port
    await site.start()
    port = site._server.sockets[0].getsockname()[1]

    # Step B: Register mock server in Redis (by-framework 0.2.x key format)
    service_name = "test-kb-discovery-svc-s2"
    instance_id = f"{service_name}:test-instance"
    instance_json = json.dumps(
        {
            "id": instance_id,
            "host": "127.0.0.1",
            "port": port,
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
        # Step C: Call _call_via_discovery
        from kgw.dispatcher import _call_via_discovery

        result = await _call_via_discovery(
            domain_name=service_name,
            op_path="/api/v1/directories/create",
            body={"knCode": "backend_kb_x", "directoryPath": "/discovery-test"},
            headers={},
        )

        # Step D: Verify
        assert result["resultCode"] == "0"
        assert len(received) == 1
        assert received[0]["knCode"] == "backend_kb_x"

    finally:
        await r.delete(hash_key, zset_key)
        await r.srem(svc_index_key, service_name)
        await r.aclose()
        await runner.cleanup()
