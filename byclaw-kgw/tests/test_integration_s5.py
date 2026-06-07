"""S5 end-to-end integration tests: full ingest pipeline lifecycle with cleanup.

Require real OpenGauss + Redis + MinIO from .env.
Run: uv run pytest -m integration tests/test_integration_s5.py -v
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
import redis.asyncio as redis_async
import respx
from httpx import ASGITransport

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"

_KN_CODE = "hr_s5"
_RESOURCE_CODE = "backend_hr_s5"
_KB_BASE_URL = "http://kb-s5.test"

_KB_CONFIG = {
    "resourceCode": _RESOURCE_CODE,
    "domainURL": _KB_BASE_URL,
    "domainName": "",
    "headers": {},
    "resourceService": [
        {"name": "knowledgeItemsImport", "path": "/api/v1/knowledgeItems/import"},
        {"name": "knowledgeItemsDelete", "path": "/api/v1/knowledgeItems/delete"},
        {"name": "fileToMarkdownIndex", "path": "/api/v1/fileToMarkdownIndex"},
        {
            "name": "metadataPropertiesBatchCreate",
            "path": "/api/v1/metadataProperties/batchCreate",
        },
        {
            "name": "knowledgeItemsMetadataUpdate",
            "path": "/api/v1/knowledgeItems/metadata/update",
        },
    ],
}

_KB_MINIO_KEY = f"resource/doc/KG_DOC_{_KN_CODE}.json"

_TABLES_TO_DROP = (
    "kgw_ingest_event",
    "kgw_metadata_property_sync",
    "kgw_metadata_property_binding",
    "kgw_metadata_binding_outbox",
    "kgw_metadata_property",
    "kgw_audit_log",
    "kgw_kb_write_history",
    "kgw_kb_source_lock",
    "kgw_kb_conflict_log",
    "kgw_migration",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def _s5_resources(
    pg_dsn,
    redis_url,
    minio_settings,
) -> AsyncIterator[tuple[httpx.AsyncClient, Any, Any]]:
    """Build real app wired to DB+Redis; seed KB config in MinIO; yield (client, pool, app)."""
    import aioboto3
    from kgw.audit import AuditWriter
    from kgw.auth_provider import AuthProvider
    from kgw.config_provider import KbConfigProvider
    from kgw.db import build_pool, run_migrations
    from kgw.http_client import build_http_client
    from kgw.main import build_app
    from kgw.resilience.circuit_breaker import CircuitBreakerRegistry
    from kgw.settings import get_settings

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
    await run_migrations(pool, _SQL_DIR)

    redis_client = redis_async.from_url(redis_url, decode_responses=False)
    http_client = build_http_client(
        timeout_seconds=10.0, max_connections=20, max_keepalive=5
    )

    scheme = "https" if settings.file_storage_minio_secure else "http"
    minio_ep = (
        f"{scheme}://{settings.file_storage_minio_host}"
        f":{settings.file_storage_minio_api_port}"
    )
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
    app.state.ingest_semaphore = asyncio.Semaphore(100)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, pool, app

    await audit_writer.stop()
    await http_client.aclose()
    await redis_client.aclose()

    # Drop all kgw tables so the suite is idempotent on re-run
    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()

    await pool.close()

    # Cleanup MinIO — new Session, fully closed within this block
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


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def s5_client(_s5_resources) -> httpx.AsyncClient:
    client, _, _ = _s5_resources
    return client


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def s5_pool(_s5_resources):
    _, pool, _ = _s5_resources
    return pool


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def s5_app(_s5_resources):
    _, _, app = _s5_resources
    return app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_INGEST_BASE = "/kgw/ingest/v1"
_ADMIN_BASE = "/kgw/admin/v1"

_INGEST_HEADERS = {"X-User-Id": "test_connector"}
_ADMIN_HEADERS = {"X-User-Id": "admin"}


def _ok_import_resp() -> dict[str, Any]:
    return {"resultCode": "0", "resultMsg": "success", "resultObject": {}}


def _ok_build_resp() -> dict[str, Any]:
    return {"resultCode": "0", "resultMsg": "success", "resultObject": {}}


def _ok_delete_resp() -> dict[str, Any]:
    return {"resultCode": "0", "resultMsg": "success", "resultObject": {}}


def _fail_resp(msg: str = "upstream error") -> dict[str, Any]:
    return {"resultCode": "-1", "resultMsg": msg, "resultObject": {}}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_upsert_event_done(s5_client):
    """Upsert a markdown file; expect status=done and eventId > 0."""
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/import").mock(
            return_value=httpx.Response(200, json=_ok_import_resp())
        )
        mock.post(f"{_KB_BASE_URL}/api/v1/fileToMarkdownIndex").mock(
            return_value=httpx.Response(200, json=_ok_build_resp())
        )
        resp = await s5_client.post(
            f"{_INGEST_BASE}/events",
            headers=_INGEST_HEADERS,
            json={
                "sourceId": "connector_s5",
                "itemId": "policy_a_md",
                "version": "2026-06-07T00:00:00Z",
                "op": "upsert",
                "knCode": _KN_CODE,
                "filePath": "/policy/a.md",
                "content": "# Hello",
            },
        )

    body = resp.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["status"] == "done"
    assert body["resultObject"]["eventId"] > 0


async def test_idempotent_resend(s5_client):
    """Re-sending the same event (same sourceId/itemId/version) returns already-processed."""
    # No respx mock needed — idempotency check happens in DB before any HTTP call
    resp = await s5_client.post(
        f"{_INGEST_BASE}/events",
        headers=_INGEST_HEADERS,
        json={
            "sourceId": "connector_s5",
            "itemId": "policy_a_md",
            "version": "2026-06-07T00:00:00Z",
            "op": "upsert",
            "knCode": _KN_CODE,
            "filePath": "/policy/a.md",
            "content": "# Hello",
        },
    )

    body = resp.json()
    assert body["resultCode"] == "0", body
    assert body["resultMsg"] == "already-processed"


async def test_stale_version(s5_client):
    """Sending an older version for the same filePath returns STALE_VERSION."""
    # Different sourceId/itemId to avoid idempotency conflict with test_upsert_event_done.
    # The done event from test 1 (version=2026-06-07T00:00:00Z) is already in the DB.
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/import").mock(
            return_value=httpx.Response(200, json=_ok_import_resp())
        )
        mock.post(f"{_KB_BASE_URL}/api/v1/fileToMarkdownIndex").mock(
            return_value=httpx.Response(200, json=_ok_build_resp())
        )
        resp = await s5_client.post(
            f"{_INGEST_BASE}/events",
            headers=_INGEST_HEADERS,
            json={
                "sourceId": "connector_s5_stale",
                "itemId": "policy_a_md_stale",
                "version": "2026-06-06T00:00:00Z",  # older than the done version
                "op": "upsert",
                "knCode": _KN_CODE,
                "filePath": "/policy/a.md",
                "content": "# Old Hello",
            },
        )

    body = resp.json()
    assert body["resultObject"]["status"] == "failed", body
    assert body["resultObject"]["errorType"] == "STALE_VERSION", body


async def test_source_lock_blocks_write(s5_client):
    """A manually locked file rejects connector writes with SOURCE_LOCKED."""
    # Lock the file via admin API
    lock_resp = await s5_client.post(
        f"{_ADMIN_BASE}/kbs/{_KN_CODE}/files/%2Fpolicy%2Flocked.md/lock",
        headers=_ADMIN_HEADERS,
        json={"lockOwner": "manual"},
    )
    assert lock_resp.json()["resultCode"] == "0", lock_resp.json()

    # Attempt ingest with a different user (connector != manual)
    with respx.mock(assert_all_called=False):
        resp = await s5_client.post(
            f"{_INGEST_BASE}/events",
            headers={"X-User-Id": "connector"},
            json={
                "sourceId": "connector_s5_locked",
                "itemId": "policy_locked_md",
                "version": "2026-06-07T01:00:00Z",
                "op": "upsert",
                "knCode": _KN_CODE,
                "filePath": "/policy/locked.md",
                "content": "# Locked",
            },
        )

    body = resp.json()
    assert body["resultObject"]["status"] == "failed", body
    assert body["resultObject"]["errorType"] == "SOURCE_LOCKED", body

    # Verify the conflict log was written
    conflict_resp = await s5_client.get(
        f"{_ADMIN_BASE}/conflicts",
        headers=_ADMIN_HEADERS,
        params={"knCode": _KN_CODE, "reason": "SOURCE_LOCKED"},
    )
    conflict_body = conflict_resp.json()
    assert conflict_body["resultCode"] == "0", conflict_body
    assert conflict_body["resultObject"]["total"] >= 1, conflict_body


async def test_delete_event(s5_client):
    """Delete op against an existing file returns status=done."""
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json=_ok_delete_resp())
        )
        resp = await s5_client.post(
            f"{_INGEST_BASE}/events",
            headers=_INGEST_HEADERS,
            json={
                "sourceId": "connector_s5_del",
                "itemId": "policy_to_delete_md",
                "op": "delete",
                "knCode": _KN_CODE,
                "filePath": "/policy/to-delete.md",
            },
        )

    body = resp.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["status"] == "done"


async def test_delete_replay(s5_client):
    """A failed delete event can be replayed successfully."""
    # First attempt: backend returns error → event is failed
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json=_fail_resp("upstream error"))
        )
        resp = await s5_client.post(
            f"{_INGEST_BASE}/events",
            headers=_INGEST_HEADERS,
            json={
                "sourceId": "connector_s5_replay",
                "itemId": "policy_replay_md",
                "op": "delete",
                "knCode": _KN_CODE,
                "filePath": "/policy/replay.md",
            },
        )

    body = resp.json()
    assert body["resultObject"]["status"] == "failed", body
    event_id = body["resultObject"]["eventId"]

    # Verify failed status via GET
    get_resp = await s5_client.get(f"{_INGEST_BASE}/events/{event_id}")
    get_body = get_resp.json()
    assert get_body["resultCode"] == "0", get_body
    assert get_body["resultObject"]["status"] == "failed"

    # Replay: backend now succeeds
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json=_ok_delete_resp())
        )
        replay_resp = await s5_client.post(
            f"{_INGEST_BASE}/events/{event_id}/replay",
            headers=_INGEST_HEADERS,
        )

    replay_body = replay_resp.json()
    assert replay_body["resultCode"] == "0", replay_body
    assert replay_body["resultObject"]["status"] == "done"


async def test_batch_partial(s5_client):
    """Batch with 2 events: first succeeds, second fails → resultCode=-1, succeeded=1, failed=1."""
    success_resp = httpx.Response(200, json=_ok_import_resp())
    fail_resp = httpx.Response(200, json=_fail_resp("backend error"))

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/import").mock(
            side_effect=[success_resp, fail_resp]
        )
        mock.post(f"{_KB_BASE_URL}/api/v1/fileToMarkdownIndex").mock(
            return_value=httpx.Response(200, json=_ok_build_resp())
        )
        resp = await s5_client.post(
            f"{_INGEST_BASE}/events/batch",
            headers=_INGEST_HEADERS,
            json={
                "events": [
                    {
                        "sourceId": "connector_s5_batch",
                        "itemId": "batch_item_1",
                        "op": "upsert",
                        "knCode": _KN_CODE,
                        "filePath": "/policy/batch1.md",
                        "content": "# Batch 1",
                    },
                    {
                        "sourceId": "connector_s5_batch",
                        "itemId": "batch_item_2",
                        "op": "upsert",
                        "knCode": _KN_CODE,
                        "filePath": "/policy/batch2.md",
                        "content": "# Batch 2",
                    },
                ]
            },
        )

    body = resp.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["succeeded"] == 1, body
    assert body["resultObject"]["failed"] == 1, body


async def test_audit_contains_ingest_entries(s5_client):
    """After previous ingest operations, the audit log contains entries with source=ingest."""
    resp = await s5_client.get(
        f"{_ADMIN_BASE}/audit",
        headers=_ADMIN_HEADERS,
        params={"source": "ingest", "pageSize": 20},
    )
    body = resp.json()
    assert body["resultCode"] == "0", body

    data = body["resultObject"]["data"]
    assert len(data) >= 1, f"Expected at least one ingest audit entry, got: {data}"
    assert all(entry["source"] == "ingest" for entry in data), (
        f"Expected all entries to have source='ingest', got: {data}"
    )
