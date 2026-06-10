"""Integration tests for the metadataProperty cleanup worker (Task 10)."""
# pylint: disable=redefined-outer-name

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
import respx
from httpx import Response
from kgw.db import build_pool, run_migrations
from kgw.http_client import build_http_client
from kgw.metadata.registry import create_property
from kgw.resilience.circuit_breaker import CircuitBreakerRegistry, CircuitState
from kgw.workers.cleanup import cleanup_iteration

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"

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

_ENDPOINT = "http://kb-cleanup.test"


def _make_state(http, pool):
    """Build a minimal app.state namespace for cleanup worker tests."""
    state = SimpleNamespace()
    state.auth_provider = AsyncMock()
    state.auth_provider.resolve_headers.return_value = {}
    state.circuit_breakers = CircuitBreakerRegistry()
    state.http = http
    state.pool = pool
    return state


@pytest_asyncio.fixture(scope="module")
async def cl_resources(pg_dsn: str):
    """Module-scoped pool + http client shared across all tests."""
    pool = await build_pool(pg_dsn, min_size=1, max_size=3)
    http = build_http_client(timeout_seconds=15.0, max_connections=10, max_keepalive=5)
    await run_migrations(pool, SQL_DIR)
    yield pool, http
    # teardown
    await http.aclose()
    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()
    await pool.close()


async def _clean_rows(pool) -> None:
    """Delete all property + sync rows between tests."""
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM kgw_metadata_property_sync")
        await conn.execute("DELETE FROM kgw_metadata_property")
        await conn.commit()


# ---------------------------------------------------------------------------
# Test 1: PURGING → backend success → PURGED → physical delete
# ---------------------------------------------------------------------------
async def test_purging_calls_backend_and_marks_purged(cl_resources):
    pool, http = cl_resources
    await _clean_rows(pool)

    p = await create_property(pool, property_name="col_purge1", value_type="string")
    # Mark property as DELETED
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED' WHERE property_id=%s",
            (p.property_id,),
        )
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'PURGING', NOW() - INTERVAL '10 minutes')",
            (p.property_id, _ENDPOINT),
        )
        await conn.commit()

    state = _make_state(http, pool)

    with respx.mock(base_url=_ENDPOINT) as mock:
        mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(
                200,
                json={"resultCode": "0", "resultMsg": "success", "resultObject": {}},
            )
        )
        count = await cleanup_iteration(state, backoff_minutes=5)

    assert count == 1

    # After physical delete (CASCADE), the sync row is also gone.
    # Verify property is physically deleted — that's the main invariant.
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM kgw_metadata_property WHERE property_id=%s",
                (p.property_id,),
            )
            still_there = await cur.fetchone()
    assert still_there is None


# ---------------------------------------------------------------------------
# Test 2: PURGE_FAILED beyond backoff → retried → PURGED
# ---------------------------------------------------------------------------
async def test_purge_failed_row_retried_after_backoff(cl_resources):
    pool, http = cl_resources
    await _clean_rows(pool)

    p = await create_property(pool, property_name="col_retry", value_type="string")
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED' WHERE property_id=%s",
            (p.property_id,),
        )
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'PURGE_FAILED', NOW() - INTERVAL '10 minutes')",
            (p.property_id, _ENDPOINT),
        )
        await conn.commit()

    state = _make_state(http, pool)

    with respx.mock(base_url=_ENDPOINT) as mock:
        mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(
                200,
                json={"resultCode": "0", "resultMsg": "success", "resultObject": {}},
            )
        )
        count = await cleanup_iteration(state, backoff_minutes=5)

    assert count == 1

    # After physical delete (CASCADE), sync row is gone too.
    # Verify property is physically deleted.
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM kgw_metadata_property WHERE property_id=%s",
                (p.property_id,),
            )
            still_there = await cur.fetchone()
    assert still_there is None


# ---------------------------------------------------------------------------
# Test 3: PURGE_FAILED within backoff → skipped (no backend call)
# ---------------------------------------------------------------------------
async def test_purge_failed_row_skipped_within_backoff(cl_resources):
    pool, http = cl_resources
    await _clean_rows(pool)

    p = await create_property(pool, property_name="col_skip", value_type="string")
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED' WHERE property_id=%s",
            (p.property_id,),
        )
        # last_sync_at = NOW() — well within backoff
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'PURGE_FAILED', NOW())",
            (p.property_id, _ENDPOINT),
        )
        await conn.commit()

    state = _make_state(http, pool)

    with respx.mock(base_url=_ENDPOINT, assert_all_called=False) as mock:
        route = mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(200, json={"resultCode": "0", "resultMsg": "success"})
        )
        count = await cleanup_iteration(state, backoff_minutes=5)

    # No row should be processed (within backoff)
    assert count == 0
    assert route.call_count == 0

    # Row still PURGE_FAILED
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (p.property_id, _ENDPOINT),
            )
            row = await cur.fetchone()
    assert row["sync_status"] == "PURGE_FAILED"


# ---------------------------------------------------------------------------
# Test 4: backend returns error → PURGE_FAILED
# ---------------------------------------------------------------------------
async def test_backend_failure_marks_purge_failed(cl_resources):
    pool, http = cl_resources
    await _clean_rows(pool)

    p = await create_property(pool, property_name="col_fail", value_type="string")
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED' WHERE property_id=%s",
            (p.property_id,),
        )
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'PURGING', NOW() - INTERVAL '10 minutes')",
            (p.property_id, _ENDPOINT),
        )
        await conn.commit()

    state = _make_state(http, pool)

    with respx.mock(base_url=_ENDPOINT) as mock:
        mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(
                200,
                json={
                    "resultCode": "500",
                    "resultMsg": "internal server error",
                    "resultObject": {},
                },
            )
        )
        count = await cleanup_iteration(state, backoff_minutes=5)

    assert count == 1

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (p.property_id, _ENDPOINT),
            )
            row = await cur.fetchone()
    assert row["sync_status"] == "PURGE_FAILED"


# ---------------------------------------------------------------------------
# Test 5: one PURGED + one PURGING → property NOT deleted yet
# ---------------------------------------------------------------------------
async def test_property_not_deleted_when_some_endpoints_still_purging(cl_resources):
    pool, http = cl_resources
    await _clean_rows(pool)

    p = await create_property(pool, property_name="col_partial", value_type="string")
    endpoint2 = "http://kb-cleanup2.test"
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED' WHERE property_id=%s",
            (p.property_id,),
        )
        # First endpoint already PURGED
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'PURGED', NOW() - INTERVAL '10 minutes')",
            (p.property_id, _ENDPOINT),
        )
        # Second endpoint still PURGING — but will fail in this call
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'PURGING', NOW() - INTERVAL '10 minutes')",
            (p.property_id, endpoint2),
        )
        await conn.commit()

    state = _make_state(http, pool)

    with respx.mock(base_url=endpoint2) as mock:
        mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(
                200,
                json={"resultCode": "500", "resultMsg": "backend down"},
            )
        )
        await cleanup_iteration(state, backoff_minutes=5)

    # Property should still exist — one endpoint is PURGE_FAILED, not PURGED
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM kgw_metadata_property WHERE property_id=%s",
                (p.property_id,),
            )
            still_there = await cur.fetchone()
    assert still_there is not None


# ---------------------------------------------------------------------------
# Test 6: only SYNCED rows → no backend calls, returns 0
# ---------------------------------------------------------------------------
async def test_no_rows_when_all_synced(cl_resources):
    pool, http = cl_resources
    await _clean_rows(pool)

    p = await create_property(pool, property_name="col_synced", value_type="string")
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'SYNCED', NOW())",
            (p.property_id, _ENDPOINT),
        )
        await conn.commit()

    state = _make_state(http, pool)

    with respx.mock(base_url=_ENDPOINT, assert_all_called=False) as mock:
        route = mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(200, json={"resultCode": "0"})
        )
        count = await cleanup_iteration(state, backoff_minutes=5)

    assert count == 0
    assert route.call_count == 0


# ---------------------------------------------------------------------------
# Test 7: circuit OPEN → no backend call, row stays PURGING
# ---------------------------------------------------------------------------
async def test_circuit_open_skips_purge(cl_resources):
    pool, http = cl_resources
    await _clean_rows(pool)

    p = await create_property(pool, property_name="col_cb_open", value_type="string")
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE kgw_metadata_property SET status='DELETED' WHERE property_id=%s",
            (p.property_id,),
        )
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'PURGING', NOW() - INTERVAL '10 minutes')",
            (p.property_id, _ENDPOINT),
        )
        await conn.commit()

    state = _make_state(http, pool)

    # Force the circuit breaker for this endpoint into OPEN state
    cb = state.circuit_breakers.get(_ENDPOINT)
    # Trip the breaker by recording failures up to threshold
    for _ in range(cb.failure_threshold):
        cb.record_failure()
    assert cb.state == CircuitState.OPEN

    with respx.mock(base_url=_ENDPOINT, assert_all_called=False) as mock:
        route = mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(200, json={"resultCode": "0"})
        )
        count = await cleanup_iteration(state, backoff_minutes=5)

    # Row was fetched (processed=1) but no backend call was made
    assert count == 1
    assert route.call_count == 0

    # Row should still be PURGING
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (p.property_id, _ENDPOINT),
            )
            row = await cur.fetchone()
    assert row["sync_status"] == "PURGING"
