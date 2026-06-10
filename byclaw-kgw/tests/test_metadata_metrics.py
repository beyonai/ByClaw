"""Integration tests for S4 metadata Prometheus metrics + stale SYNCING cleanup."""

# pylint: disable=redefined-outer-name

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
import respx
from httpx import Response
from kgw.config_provider import KbConfig
from kgw.db import build_pool, run_migrations
from kgw.http_client import build_http_client
from kgw.metadata.registry import create_property
from kgw.metadata.sync import SyncStatus, ensure_synced, get_sync_status
from kgw.observability.metrics import kgw_metadata_sync_total
from kgw.resilience.circuit_breaker import CircuitBreakerRegistry
from kgw.workers.binding_reconcile import reconcile_iteration

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"

_ENDPOINT = "http://kb-metrics.test"
_KN_CODE = "metrics_kb"

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


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def met_pool(pg_dsn: str):
    """Module-scoped pool shared across all metrics tests."""
    pool = await build_pool(pg_dsn, min_size=1, max_size=3)
    await run_migrations(pool, SQL_DIR)
    yield pool
    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()
    await pool.close()


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def met_http():
    """Module-scoped HTTP client shared across all metrics tests."""
    http = build_http_client(timeout_seconds=15.0, max_connections=10, max_keepalive=5)
    yield http
    await http.aclose()


def _make_state(
    http, pool, *, domain_url=_ENDPOINT, domain_name="", operation_paths=None
):
    """Build a minimal app.state namespace matching the ensure_synced signature."""
    state = SimpleNamespace()
    state.config_provider = AsyncMock()
    state.config_provider.get_kb_config.return_value = KbConfig(
        kn_code=_KN_CODE,
        resource_code=_KN_CODE,
        domain_url=domain_url,
        domain_name=domain_name,
        headers={},
        operations=frozenset(),
        operation_paths=operation_paths or {},
        raw={},
    )
    state.auth_provider = AsyncMock()
    state.auth_provider.resolve_headers.return_value = {}
    state.circuit_breakers = CircuitBreakerRegistry()
    state.http = http
    state.pool = pool
    return state


# ---------------------------------------------------------------------------
# Test 1: successful sync increments success counter
# ---------------------------------------------------------------------------
async def test_sync_success_increments_counter(met_pool, met_http):
    p = await create_property(met_pool, property_name="mt_sync_ok", value_type="string")
    state = _make_state(met_http, met_pool)

    before = kgw_metadata_sync_total.labels(result="success")._value.get()

    with respx.mock(base_url=_ENDPOINT) as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=Response(
                200,
                json={"resultCode": "0", "resultMsg": "success", "resultObject": {}},
            )
        )
        await ensure_synced(
            state, property_id=p.property_id, kn_code=_KN_CODE, user_code="u1"
        )

    after = kgw_metadata_sync_total.labels(result="success")._value.get()
    assert after >= before + 1

    status = await get_sync_status(met_pool, p.property_id, _ENDPOINT)
    assert status == SyncStatus.SYNCED


# ---------------------------------------------------------------------------
# Test 2: circuit open increments circuit_open counter
# ---------------------------------------------------------------------------
async def test_sync_circuit_open_increments_counter(met_pool, met_http):
    from kgw.envelope import CircuitOpen

    p = await create_property(met_pool, property_name="mt_sync_cb", value_type="string")
    state = _make_state(met_http, met_pool)

    # Force the circuit breaker OPEN by recording enough failures
    cb = state.circuit_breakers.get(_ENDPOINT)
    for _ in range(10):
        cb.before_call()
        cb.record_failure()

    before = kgw_metadata_sync_total.labels(result="circuit_open")._value.get()

    with pytest.raises(CircuitOpen):
        await ensure_synced(
            state, property_id=p.property_id, kn_code=_KN_CODE, user_code="u1"
        )

    after = kgw_metadata_sync_total.labels(result="circuit_open")._value.get()
    assert after >= before + 1


# ---------------------------------------------------------------------------
# Test 3: stale SYNCING row is flipped to FAILED by reconcile
# ---------------------------------------------------------------------------
async def test_stale_syncing_cleared_by_reconcile(met_pool):
    p = await create_property(
        met_pool, property_name="mt_stale_sync", value_type="string"
    )

    # Insert a SYNCING row with last_sync_at 15 minutes ago
    async with met_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at, last_error) "
            "VALUES (%s, %s, 'SYNCING', NOW() - INTERVAL '15 minutes', NULL)",
            (p.property_id, "http://stale-endpoint.test"),
        )
        await conn.commit()

    _, _, syncing_n = await reconcile_iteration(
        met_pool, stale_syncing_threshold_minutes=10
    )
    assert syncing_n >= 1

    async with met_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (p.property_id, "http://stale-endpoint.test"),
            )
            row = await cur.fetchone()

    assert row is not None
    assert row["sync_status"] == "FAILED"


# ---------------------------------------------------------------------------
# Test 4: fresh SYNCING row is not touched by reconcile
# ---------------------------------------------------------------------------
async def test_fresh_syncing_not_cleared(met_pool):
    p = await create_property(
        met_pool, property_name="mt_fresh_sync", value_type="string"
    )

    # Insert a SYNCING row with last_sync_at = NOW()
    async with met_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at, last_error) "
            "VALUES (%s, %s, 'SYNCING', NOW(), NULL)",
            (p.property_id, "http://fresh-endpoint.test"),
        )
        await conn.commit()

    await reconcile_iteration(met_pool, stale_syncing_threshold_minutes=10)

    async with met_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (p.property_id, "http://fresh-endpoint.test"),
            )
            row = await cur.fetchone()

    assert row is not None
    assert row["sync_status"] == "SYNCING"


# ---------------------------------------------------------------------------
# Test 5: reconcile_iteration returns a 3-tuple of ints
# ---------------------------------------------------------------------------
async def test_reconcile_returns_3_tuple(met_pool):
    result = await reconcile_iteration(met_pool)
    assert isinstance(result, tuple)
    assert len(result) == 3
    assert all(isinstance(v, int) for v in result)
