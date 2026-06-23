"""Integration tests for admin metadataProperty endpoints.

Require real OpenGauss + Redis + MinIO from .env.
Run: uv run pytest -m integration tests/test_api_admin_metadata.py -v
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
import redis.asyncio as redis_async
from httpx import ASGITransport

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"

# Unique knCode prefix to avoid collisions with other test modules
_ADM_KN_CODE = "hr_adm"
_ADM_DOMAIN_URL = "http://kb-hr-adm.internal"

_TABLES_TO_DROP = (
    "kgw_metadata_property_sync",
    "kgw_metadata_property_binding",
    "kgw_metadata_property",
    "kgw_audit_log",
    "kgw_kb_source_lock",
    "kgw_kb_conflict_log",
    "kgw_migration",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def _adm_resources(
    pg_dsn,
    redis_url,
) -> AsyncIterator[tuple[httpx.AsyncClient, object]]:
    """Build real app wired to DB+Redis; seed hr_adm KB config; yield (client, pool)."""
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

    # Seed hr_adm KB config in Redis so sync-retry knCode filter can resolve it
    redis_key = f"KG_DOC_{_ADM_KN_CODE}"
    kb_cfg_payload = {
        "resourceCode": _ADM_KN_CODE,
        "domainURL": _ADM_DOMAIN_URL,
        "domainName": "",
        "headers": {},
        "resourceService": [],
    }

    pool = await build_pool(pg_dsn, min_size=1, max_size=5)
    await run_migrations(pool, _SQL_DIR)

    redis_client = redis_async.from_url(redis_url, decode_responses=False)

    await redis_client.set(redis_key, json.dumps(kb_cfg_payload))

    http_client = build_http_client(
        timeout_seconds=10.0, max_connections=20, max_keepalive=5
    )

    config_provider = KbConfigProvider(redis_client=redis_client)
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
        yield client, pool

    await audit_writer.stop()
    await http_client.aclose()
    await redis_client.aclose()

    # Clean up Redis seed
    try:
        await redis_client.delete(redis_key)
    except Exception:  # noqa: BLE001
        pass

    # Drop all kgw tables so the suite is idempotent on re-run
    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()

    await pool.close()


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def adm_client(_adm_resources) -> httpx.AsyncClient:
    client, _ = _adm_resources
    return client


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def adm_pool(_adm_resources):
    _, pool = _adm_resources
    return pool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_API = "/kgw/api/v1/metadataProperties"
_BASE_ADMIN = "/kgw/admin/v1/metadata-properties"
_REMOVED_ORPHAN_KEY = "stale" + "Pend" + "ing"


async def _create_property(
    client: httpx.AsyncClient, name: str, value_type: str = "string"
) -> None:
    r = await client.post(
        f"{_BASE_API}/create",
        json={"propertyName": name, "valueType": value_type},
    )
    assert r.status_code == 200
    assert r.json()["resultCode"] == "0", r.json()


async def _query_property_id(
    pool, property_name: str, active_only: bool = True
) -> int | None:
    """Direct SQL lookup for property_id by name."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if active_only:
                await cur.execute(
                    "SELECT property_id FROM kgw_metadata_property "
                    "WHERE property_name=%s AND status='ACTIVE'",
                    (property_name,),
                )
            else:
                await cur.execute(
                    "SELECT property_id FROM kgw_metadata_property "
                    "WHERE property_name=%s ORDER BY property_id DESC LIMIT 1",
                    (property_name,),
                )
            row = await cur.fetchone()
    return row["property_id"] if row else None


async def _insert_sync_row(
    pool,
    property_id: int,
    endpoint_key: str,
    sync_status: str,
    last_error: str | None = None,
) -> None:
    """Insert or update a sync row (OpenGauss has no ON CONFLICT support)."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (property_id, endpoint_key),
            )
            exists = await cur.fetchone()
            if exists:
                await cur.execute(
                    "UPDATE kgw_metadata_property_sync "
                    "SET sync_status=%s, last_error=%s "
                    "WHERE property_id=%s AND endpoint_key=%s",
                    (sync_status, last_error, property_id, endpoint_key),
                )
            else:
                await cur.execute(
                    "INSERT INTO kgw_metadata_property_sync "
                    "(property_id, endpoint_key, sync_status, last_error) "
                    "VALUES (%s, %s, %s, %s)",
                    (property_id, endpoint_key, sync_status, last_error),
                )
        await conn.commit()


async def _query_sync_status(pool, property_id: int, endpoint_key: str) -> str | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (property_id, endpoint_key),
            )
            row = await cur.fetchone()
    return row["sync_status"] if row else None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_list_all_returns_active_and_deleted(adm_client, adm_pool):
    """GET /kgw/admin/v1/metadata-properties returns DELETED rows too."""
    await _create_property(adm_client, "ad1")
    pid = await _query_property_id(adm_pool, "ad1")
    assert pid is not None

    # Manually set status='DELETED'
    async with adm_pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED', deleted_at=NOW() "
            "WHERE property_id=%s",
            (pid,),
        )
        await conn.commit()

    r = await adm_client.get(_BASE_ADMIN)
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body

    items = body["resultObject"]["data"]
    names = {item["propertyName"] for item in items}
    assert "ad1" in names

    ad1_item = next(i for i in items if i["propertyName"] == "ad1")
    assert ad1_item["status"] == "DELETED"


async def test_list_all_includes_sync_details(adm_client, adm_pool):
    """GET /kgw/admin/v1/metadata-properties includes syncDetails per property."""
    await _create_property(adm_client, "ad2")
    pid = await _query_property_id(adm_pool, "ad2")
    assert pid is not None

    await _insert_sync_row(
        adm_pool, pid, "http://kb.test", "FAILED", "connection refused"
    )

    r = await adm_client.get(_BASE_ADMIN)
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body

    items = body["resultObject"]["data"]
    ad2_item = next((i for i in items if i["propertyName"] == "ad2"), None)
    assert ad2_item is not None
    sync_details = ad2_item["syncDetails"]
    assert len(sync_details) >= 1
    entry = next(
        (s for s in sync_details if s["endpointKey"] == "http://kb.test"), None
    )
    assert entry is not None
    assert entry["syncStatus"] == "FAILED"


async def test_sync_retry_flips_failed_to_syncing(adm_client, adm_pool):
    """POST /sync-retry with no knCode flips all FAILED rows to SYNCING."""
    await _create_property(adm_client, "ad3")
    pid = await _query_property_id(adm_pool, "ad3")
    assert pid is not None

    await _insert_sync_row(adm_pool, pid, "http://kb-ad3.test", "FAILED", "timeout")

    r = await adm_client.post(
        f"{_BASE_ADMIN}/ad3/sync-retry",
        json={},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["updated"] == 1

    status = await _query_sync_status(adm_pool, pid, "http://kb-ad3.test")
    assert status == "SYNCING"


async def test_sync_retry_with_kn_code_filter(adm_client, adm_pool):
    """POST /sync-retry with knCode only flips the matching endpoint_key row."""
    await _create_property(adm_client, "ad4")
    pid = await _query_property_id(adm_pool, "ad4")
    assert pid is not None

    # Insert two FAILED sync rows: one matching hr_adm's domain_url, one not
    await _insert_sync_row(adm_pool, pid, _ADM_DOMAIN_URL, "FAILED", "err1")
    await _insert_sync_row(
        adm_pool, pid, "http://other-endpoint.test", "FAILED", "err2"
    )

    r = await adm_client.post(
        f"{_BASE_ADMIN}/ad4/sync-retry",
        json={"knCode": _ADM_KN_CODE},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["updated"] == 1

    # Only the hr_adm endpoint should be flipped
    assert await _query_sync_status(adm_pool, pid, _ADM_DOMAIN_URL) == "SYNCING"
    assert (
        await _query_sync_status(adm_pool, pid, "http://other-endpoint.test")
        == "FAILED"
    )


async def test_purge_retry_flips_purge_failed_to_purging(adm_client, adm_pool):
    """POST /purge-retry flips PURGE_FAILED rows to PURGING (works for DELETED properties)."""
    await _create_property(adm_client, "ad5")
    pid = await _query_property_id(adm_pool, "ad5")
    assert pid is not None

    # Set property to DELETED
    async with adm_pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED', deleted_at=NOW() "
            "WHERE property_id=%s",
            (pid,),
        )
        await conn.commit()

    await _insert_sync_row(
        adm_pool, pid, "http://kb-ad5.test", "PURGE_FAILED", "cleanup err"
    )

    r = await adm_client.post(
        f"{_BASE_ADMIN}/ad5/purge-retry",
        json={},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["updated"] == 1

    status = await _query_sync_status(adm_pool, pid, "http://kb-ad5.test")
    assert status == "PURGING"


async def test_orphans_returns_purge_failed(adm_client, adm_pool):
    """GET /orphans includes purgeFailed entries."""
    await _create_property(adm_client, "ad6")
    pid = await _query_property_id(adm_pool, "ad6")
    assert pid is not None

    # Delete property and insert PURGE_FAILED sync row
    async with adm_pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED', deleted_at=NOW() "
            "WHERE property_id=%s",
            (pid,),
        )
        await conn.commit()

    await _insert_sync_row(
        adm_pool, pid, "http://kb.test", "PURGE_FAILED", "cleanup failed"
    )

    r = await adm_client.get(_BASE_ADMIN + "/orphans")
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body

    pf = body["resultObject"]["purgeFailed"]
    entry = next((e for e in pf if e["propertyName"] == "ad6"), None)
    assert entry is not None
    assert entry["endpointKey"] == "http://kb.test"


async def test_orphans_returns_stale_deleting(adm_client, adm_pool):
    """GET /orphans includes staleDeleting entries older than 5 minutes."""
    await _create_property(adm_client, "ad7")
    pid = await _query_property_id(adm_pool, "ad7")
    assert pid is not None

    # Insert a DELETING binding with updated_at 10 minutes ago
    async with adm_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, bound_at, updated_at) "
            "VALUES (%s, 'hr_adm_stale', '/docs/stale.pdf', 'DELETING', "
            "NOW(), NOW() - INTERVAL '10 minutes')",
            (pid,),
        )
        await conn.commit()

    r = await adm_client.get(_BASE_ADMIN + "/orphans")
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body

    assert "staleDeleting" in body["resultObject"]
    assert _REMOVED_ORPHAN_KEY not in body["resultObject"]

    sd = body["resultObject"]["staleDeleting"]
    entry = next((e for e in sd if e["propertyName"] == "ad7"), None)
    assert entry is not None
    assert entry["propertyId"] == pid
    assert entry["knCode"] == "hr_adm_stale"
    assert entry["filePath"] == "/docs/stale.pdf"
    assert entry["status"] == "DELETING"
    assert entry["updatedAt"] is not None


async def test_orphans_fresh_deleting_not_returned(adm_client, adm_pool):
    """GET /orphans does NOT return DELETING bindings updated just now."""
    await _create_property(adm_client, "ad8")
    pid = await _query_property_id(adm_pool, "ad8")
    assert pid is not None

    # Insert a fresh DELETING binding
    async with adm_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, bound_at, updated_at) "
            "VALUES (%s, 'hr_adm_fresh', '/docs/fresh.pdf', 'DELETING', "
            "NOW(), NOW())",
            (pid,),
        )
        await conn.commit()

    r = await adm_client.get(_BASE_ADMIN + "/orphans")
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body

    assert "staleDeleting" in body["resultObject"]
    assert _REMOVED_ORPHAN_KEY not in body["resultObject"]

    sd = body["resultObject"]["staleDeleting"]
    # This fresh binding must NOT appear
    fresh = next(
        (e for e in sd if e["propertyName"] == "ad8" and e["knCode"] == "hr_adm_fresh"),
        None,
    )
    assert fresh is None
