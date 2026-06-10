"""Integration tests for metadataProperties HTTP endpoints.

Require real OpenGauss + Redis from .env.
Run: uv run pytest -m integration tests/test_api_metadata_properties.py -v
"""
# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
import redis.asyncio as redis_async
from httpx import ASGITransport

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"

_TABLES_TO_DROP = (
    "kgw_metadata_property_sync",
    "kgw_metadata_property_binding",
    "kgw_metadata_binding_outbox",
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
async def _mp_resources(  # pylint: disable=redefined-outer-name
    pg_dsn,
    redis_url,
) -> AsyncIterator[tuple[httpx.AsyncClient, Any]]:
    """Build real app wired to DB+Redis; yield (client, pool); teardown after."""
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

    pool = await build_pool(pg_dsn, min_size=1, max_size=5)
    await run_migrations(pool, _SQL_DIR)

    redis_client = redis_async.from_url(redis_url, decode_responses=False)
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

    # Drop all kgw tables so the suite is idempotent on re-run
    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()

    await pool.close()


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def mp_client(_mp_resources) -> httpx.AsyncClient:
    client, _ = _mp_resources
    return client


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def mp_pool(_mp_resources):
    _, pool = _mp_resources
    return pool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE = "/kgw/api/v1/metadataProperties"


async def _query_property_id(pool, property_name: str) -> int | None:
    """Direct SQL lookup for property_id by name (ACTIVE rows only)."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property "
                "WHERE property_name=%s AND status='ACTIVE'",
                (property_name,),
            )
            row = await cur.fetchone()
    return row["property_id"] if row else None


# ---------------------------------------------------------------------------
# Tests — plan-specified
# ---------------------------------------------------------------------------


async def test_create_then_list(mp_client, mp_pool):  # pylint: disable=unused-argument
    r = await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_e1", "valueType": "string"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["propertyName"] == "t_e1"

    r2 = await mp_client.post(
        f"{_BASE}/list",
        json={"propertyNameList": ["t_e1"]},
    )
    assert r2.status_code == 200
    data = r2.json()["resultObject"]["data"]
    names = [p["propertyName"] for p in data]
    assert "t_e1" in names


async def test_create_duplicate_returns_already_exists(mp_client):
    await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_e2", "valueType": "string"},
    )
    r = await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_e2", "valueType": "number"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "MetadataPropertyAlreadyExists"


async def test_delete_when_unused(mp_client):
    await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_e3", "valueType": "boolean"},
    )
    r_del = await mp_client.post(
        f"{_BASE}/delete",
        json={"propertyName": "t_e3"},
    )
    assert r_del.status_code == 200
    assert r_del.json()["resultCode"] == "0", r_del.json()

    r_list = await mp_client.post(
        f"{_BASE}/list",
        json={"propertyNameList": ["t_e3"]},
    )
    assert r_list.json()["resultObject"]["data"] == []


async def test_delete_rejected_when_in_use(mp_client, mp_pool):
    await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_e4", "valueType": "string"},
    )
    pid = await _query_property_id(mp_pool, "t_e4")
    assert pid is not None

    # Manually insert a SYNCED binding row to simulate in-use state
    async with mp_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
            "VALUES (%s, 'kn_test', '/docs/file.pdf', 'SYNCED', 1, NOW())",
            (pid,),
        )
        await conn.commit()

    r = await mp_client.post(
        f"{_BASE}/delete",
        json={"propertyName": "t_e4"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "MetadataPropertyInUse"
    assert body["resultObject"]["totalReferences"] == 1
    assert isinstance(body["resultObject"]["inUseSamples"], list)
    assert len(body["resultObject"]["inUseSamples"]) >= 1


async def test_batch_create_atomic_rollback(mp_client):
    # Pre-create t_e5 so batchCreate with [t_e6, t_e5] will conflict
    await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_e5", "valueType": "string"},
    )

    r = await mp_client.post(
        f"{_BASE}/batchCreate",
        json={
            "propertyList": [
                {"propertyName": "t_e6", "valueType": "string"},
                {"propertyName": "t_e5", "valueType": "number"},  # duplicate
            ]
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "MetadataPropertyAlreadyExists"
    assert body["resultObject"]["propertyName"] == "t_e5"

    # t_e6 must NOT have been persisted (whole tx rolled back)
    r_list = await mp_client.post(
        f"{_BASE}/list",
        json={"propertyNameList": ["t_e6"]},
    )
    assert r_list.json()["resultObject"]["data"] == []


# ---------------------------------------------------------------------------
# Tests — additional (required by task spec)
# ---------------------------------------------------------------------------


async def test_create_invalid_value_type(mp_client):
    r = await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_inv", "valueType": "blob"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "INVALID_VALUE_TYPE"


async def test_batch_create_in_batch_duplicate(mp_client):
    unique_name = f"t_dup_{uuid.uuid4().hex[:8]}"
    r = await mp_client.post(
        f"{_BASE}/batchCreate",
        json={
            "propertyList": [
                {"propertyName": unique_name, "valueType": "string"},
                {"propertyName": unique_name, "valueType": "number"},
            ]
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "INVALID_BATCH_DUPLICATE_NAME"

    # Neither item should have been persisted
    r_list = await mp_client.post(
        f"{_BASE}/list",
        json={"propertyNameList": [unique_name]},
    )
    assert r_list.json()["resultObject"]["data"] == []


async def test_delete_unknown_property_returns_not_found(mp_client):
    r = await mp_client.post(
        f"{_BASE}/delete",
        json={"propertyName": "t_nonexistent_xyz_999"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "MetadataPropertyNotFound"


async def test_delete_then_recreate_with_same_name(mp_client, mp_pool):
    # First create
    r1 = await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_re", "valueType": "string"},
    )
    assert r1.json()["resultCode"] == "0", r1.json()
    pid1 = await _query_property_id(mp_pool, "t_re")

    # Delete
    r_del = await mp_client.post(
        f"{_BASE}/delete",
        json={"propertyName": "t_re"},
    )
    assert r_del.json()["resultCode"] == "0", r_del.json()

    # Recreate with same name, different type
    r2 = await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "t_re", "valueType": "number"},
    )
    assert r2.json()["resultCode"] == "0", r2.json()
    pid2 = await _query_property_id(mp_pool, "t_re")

    assert pid2 is not None
    assert pid1 != pid2

    # Verify different backend_name via list
    r_list = await mp_client.post(
        f"{_BASE}/list",
        json={"propertyNameList": ["t_re"]},
    )
    data = r_list.json()["resultObject"]["data"]
    assert len(data) == 1
    assert data[0]["propertyName"] == "t_re"
    assert data[0]["valueType"] == "number"

    # Check backend_name via direct SQL
    async with mp_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT backend_name FROM kgw_metadata_property WHERE property_id=%s",
                (pid2,),
            )
            row = await cur.fetchone()
    assert row is not None
    assert f"__v{pid2}" in row["backend_name"]
    # Must be different from the original backend_name
    async with mp_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT backend_name FROM kgw_metadata_property WHERE property_id=%s",
                (pid1,),
            )
            row1 = await cur.fetchone()
    assert row1["backend_name"] != row["backend_name"]


async def test_create_empty_property_name_rejected(mp_client):
    # Empty string propertyName
    r = await mp_client.post(
        f"{_BASE}/create",
        json={"propertyName": "", "valueType": "string"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "INVALID_PROPERTY_NAME"

    # Missing propertyName key entirely
    r2 = await mp_client.post(
        f"{_BASE}/create",
        json={"valueType": "string"},
    )
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["resultCode"] == "-1", body2
    assert body2["resultObject"]["errorCode"] == "INVALID_PROPERTY_NAME"


async def test_batch_create_missing_property_name_rejected(mp_client):
    r = await mp_client.post(
        f"{_BASE}/batchCreate",
        json={
            "propertyList": [
                {"valueType": "string"},  # missing propertyName
                {"propertyName": "t_ok", "valueType": "string"},
            ]
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "INVALID_PROPERTY_NAME"

    # t_ok must NOT have been persisted (pre-validation raised before any DB write)
    r_list = await mp_client.post(
        f"{_BASE}/list",
        json={"propertyNameList": ["t_ok"]},
    )
    assert r_list.json()["resultObject"]["data"] == []
