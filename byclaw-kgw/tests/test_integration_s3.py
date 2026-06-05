"""S3 integration tests — multi-KB fanout + streaming download.

Require real OpenGauss + Redis + MinIO from .env.
Run: uv run pytest -m integration tests/test_integration_s3.py -v
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
import redis.asyncio as redis_async
import respx
from httpx import ASGITransport

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]


def _kb_config(resource_code: str, domain_url: str) -> dict:
    return {
        "resourceCode": resource_code,
        "domainURL": domain_url,
        "domainName": "kb-mock",
        "headers": {},
        "resourceService": [
            {
                "name": "knowledgeSearch",
                "path": "/api/v1/knowledgeItems/search",
            },
            {"name": "listDir", "path": "/api/v1/listDir"},
            {"name": "downloadFile", "path": "/api/v1/downloadFile"},
        ],
    }


_KBS = {
    "kb_s3_a": _kb_config("backend_s3_a", "http://kb-s3-a.internal"),
    "kb_s3_b": _kb_config("backend_s3_b", "http://kb-s3-b.internal"),
    "kb_s3_c": _kb_config("backend_s3_c", "http://kb-s3-c.internal"),
}


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def s3_client(pg_dsn, redis_url, minio_settings) -> AsyncIterator:  # pylint: disable=unused-argument,redefined-outer-name
    """App wired with real backends + 3 KB configs seeded in MinIO."""
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

    seeded_keys: list[str] = []
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        for kn_code, cfg in _KBS.items():
            key = f"resource/doc/KG_DOC_{kn_code}.json"
            await s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=json.dumps(cfg).encode(),
                ContentType="application/json",
            )
            seeded_keys.append(key)

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

    try:
        async with aioboto3.Session().client(
            "s3",
            endpoint_url=minio_settings["endpoint_url"],
            aws_access_key_id=minio_settings["access_key"],
            aws_secret_access_key=minio_settings["secret_key"],
        ) as s3:
            for k in seeded_keys:
                await s3.delete_object(Bucket=bucket, Key=k)
    except Exception:  # noqa: BLE001
        pass


async def test_fanout_one_kb_failure_others_ok(s3_client):  # pylint: disable=redefined-outer-name
    """3-KB search where kb_s3_b times out → A/C succeed, B in degraded_kbs."""
    with respx.mock(assert_all_called=False) as r:
        r.post("http://kb-s3-a.internal/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {"data": [{"id": "a1"}]},
                },
            )
        )
        r.post("http://kb-s3-b.internal/api/v1/knowledgeItems/search").mock(
            side_effect=httpx.TimeoutException("upstream timeout")
        )
        r.post("http://kb-s3-c.internal/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {"data": [{"id": "c1"}]},
                },
            )
        )
        resp = await s3_client.post(
            "/kgw/api/v1/knowledgeItems/search",
            json={
                "knCodeList": ["kb_s3_a", "kb_s3_b", "kb_s3_c"],
                "query": "x",
            },
            headers={"X-User-Id": "s3_user"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "0"
    ids = sorted(d["id"] for d in body["resultObject"]["data"])
    assert ids == ["a1", "c1"]
    deg = body["resultObject"]["degraded_kbs"]
    assert any(d["knCode"] == "kb_s3_b" for d in deg)


async def test_circuit_open_kb_into_degraded(s3_client):  # pylint: disable=redefined-outer-name
    """A pre-tripped circuit on kb_s3_b → fanout marks B degraded with reason=CircuitOpen."""
    with respx.mock(assert_all_called=False) as r:
        r.post("http://kb-s3-b.internal/api/v1/listDir").mock(
            side_effect=httpx.ConnectError("simulated down")
        )
        for _ in range(5):
            await s3_client.post(
                "/kgw/api/v1/listDir",
                json={"knCode": "kb_s3_b", "directoryPath": "/"},
                headers={"X-User-Id": "s3_user"},
            )
    with respx.mock(assert_all_called=False) as r:
        r.post("http://kb-s3-a.internal/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {"data": []},
                },
            )
        )
        resp = await s3_client.post(
            "/kgw/api/v1/knowledgeItems/search",
            json={"knCodeList": ["kb_s3_a", "kb_s3_b"], "query": "x"},
            headers={"X-User-Id": "s3_user"},
        )
    body = resp.json()
    deg = body["resultObject"]["degraded_kbs"]
    assert any(d["knCode"] == "kb_s3_b" and d["reason"] == "CircuitOpen" for d in deg)


async def test_download_file_streams(s3_client):  # pylint: disable=redefined-outer-name
    """100KB octet-stream download succeeds end-to-end."""
    payload = b"x" * (100 * 1024)
    with respx.mock(assert_all_called=False) as r:
        r.post("http://kb-s3-a.internal/api/v1/downloadFile").mock(
            return_value=httpx.Response(
                200,
                content=payload,
                headers={
                    "content-type": "application/octet-stream",
                    "content-disposition": 'attachment; filename="x.bin"',
                },
            )
        )
        resp = await s3_client.post(
            "/kgw/api/v1/downloadFile",
            json={"knCode": "kb_s3_a", "filePath": "/x.bin"},
            headers={"X-User-Id": "s3_user"},
        )
    assert resp.status_code == 200
    assert resp.content == payload
    assert "attachment" in resp.headers.get("content-disposition", "")


async def test_list_dir_single_kb(s3_client):  # pylint: disable=redefined-outer-name
    """Single-KB read passes through dispatch_json without write_history."""
    with respx.mock(assert_all_called=False) as r:
        r.post("http://kb-s3-a.internal/api/v1/listDir").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {"items": []},
                },
            )
        )
        resp = await s3_client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": "kb_s3_a", "directoryPath": "/"},
            headers={"X-User-Id": "s3_user"},
        )
    assert resp.status_code == 200
    assert resp.json()["resultCode"] == "0"
