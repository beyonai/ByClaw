"""S4 end-to-end integration tests: full metadataProperty lifecycle with cleanup.

Require real OpenGauss + Redis + MinIO from .env.
Run: uv run pytest -m integration tests/test_integration_s4.py -v
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

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

_KN_CODE = "hr_s4"
_RESOURCE_CODE = "backend_hr_s4"
_KB_BASE_URL = "http://kb-s4.test"

_KB_CONFIG = {
    "resourceCode": _RESOURCE_CODE,
    "domainURL": _KB_BASE_URL,
    "domainName": "",
    "headers": {},
    "resourceService": [
        {
            "name": "metadataPropertiesBatchCreate",
            "path": "/api/v1/metadataProperties/batchCreate",
        },
        {
            "name": "knowledgeItemsMetadataUpdate",
            "path": "/api/v1/knowledgeItems/metadata/update",
        },
        {
            "name": "knowledgeItemsMetadataGet",
            "path": "/api/v1/knowledgeItems/metadata/get",
        },
        {
            "name": "knowledgeSearch",
            "path": "/api/v1/knowledgeItems/search",
        },
        {
            "name": "metadataPropertiesDelete",
            "path": "/api/v1/metadataProperties/delete",
        },
    ],
}

_KB_REDIS_KEY = f"KG_DOC_{_KN_CODE}"

_TABLES_TO_DROP = (
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
async def _s4_resources(
    pg_dsn,
    redis_url,
) -> AsyncIterator[tuple[httpx.AsyncClient, Any, Any]]:
    """Build real app wired to DB+Redis; seed KB config in Redis; yield (client, pool, app)."""
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

    # Seed KB config in Redis
    await redis_client.set(_KB_REDIS_KEY, json.dumps(_KB_CONFIG))

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

    # Cleanup Redis KB config
    try:
        await redis_client.delete(_KB_REDIS_KEY)
    except Exception:  # noqa: BLE001
        pass


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def s4_client(_s4_resources) -> httpx.AsyncClient:
    client, _, _ = _s4_resources
    return client


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def s4_pool(_s4_resources):
    _, pool, _ = _s4_resources
    return pool


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def s4_app(_s4_resources):
    _, _, app = _s4_resources
    return app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MP_BASE = "/kgw/api/v1/metadataProperties"
_ITEMS_BASE = "/kgw/api/v1/knowledgeItems"


def _ok_metadata_resp(kn_code: str = _RESOURCE_CODE) -> dict[str, Any]:
    """Minimal successful backend metadata update response."""
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"knCode": kn_code, "filePath": "/e.md", "metadata": {}},
    }


def _ok_resp() -> dict[str, Any]:
    """Minimal successful backend response."""
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {},
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_e2e_create_use_delete_recreate_with_cleanup(s4_client, s4_pool, s4_app):
    """Full S4 lifecycle: create → set binding → delete blocked → unset → delete →
    cleanup iteration (PURGING→PURGED→physical delete) → recreate with same name."""
    from types import SimpleNamespace

    from kgw.resilience.circuit_breaker import CircuitBreakerRegistry
    from kgw.workers.cleanup import cleanup_iteration

    # 1. Create property
    resp = await s4_client.post(
        f"{_MP_BASE}/create",
        json={"propertyName": "e2e_x", "valueType": "string"},
    )
    assert resp.json()["resultCode"] == "0", resp.json()

    # 2. metadata/update set → creates binding, triggers lazy sync
    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=httpx.Response(200, json=_ok_metadata_resp())
        )
        resp = await s4_client.post(
            f"{_ITEMS_BASE}/metadata/update",
            headers={"X-User-Id": "u1"},
            json={
                "knCode": _KN_CODE,
                "filePath": "/e.md",
                "operationList": [
                    {"propertyName": "e2e_x", "operation": "set", "value": "v"}
                ],
            },
        )
    assert resp.json()["resultCode"] == "0", resp.json()

    # 3. Delete blocked (binding exists)
    resp = await s4_client.post(
        f"{_MP_BASE}/delete",
        json={"propertyName": "e2e_x"},
    )
    del_body = resp.json()
    assert del_body["resultCode"] == "-1", del_body
    assert del_body["resultObject"]["errorCode"] == "MetadataPropertyInUse"

    # 4. metadata/update unset → releases binding
    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=httpx.Response(200, json=_ok_metadata_resp())
        )
        resp = await s4_client.post(
            f"{_ITEMS_BASE}/metadata/update",
            headers={"X-User-Id": "u1"},
            json={
                "knCode": _KN_CODE,
                "filePath": "/e.md",
                "operationList": [{"propertyName": "e2e_x", "operation": "unset"}],
            },
        )
    assert resp.json()["resultCode"] == "0", resp.json()

    # 5. Delete succeeds (no more bindings)
    resp = await s4_client.post(
        f"{_MP_BASE}/delete",
        json={"propertyName": "e2e_x"},
    )
    assert resp.json()["resultCode"] == "0", resp.json()

    # 6. Run cleanup iteration with backoff=0 → PURGING→PURGED→physical delete
    cleanup_state = SimpleNamespace(
        pool=s4_pool,
        http=s4_app.state.http,
        circuit_breakers=CircuitBreakerRegistry(),
        auth_provider=s4_app.state.auth_provider,
    )
    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        await cleanup_iteration(cleanup_state, batch_size=50, backoff_minutes=0)

    # 7. Recreate with same name (surrogate PK allows reuse)
    resp = await s4_client.post(
        f"{_MP_BASE}/create",
        json={"propertyName": "e2e_x", "valueType": "number"},
    )
    assert resp.json()["resultCode"] == "0", resp.json()


async def test_search_field_rewrite_smoke(s4_client):
    """Create a property; call /search with where.eq.fieldName = propertyName;
    assert the upstream body has the backend_name in the where clause."""
    # Create the property
    resp = await s4_client.post(
        f"{_MP_BASE}/create",
        json={"propertyName": "e2e_search_f", "valueType": "string"},
    )
    assert resp.json()["resultCode"] == "0", resp.json()

    captured_body: dict[str, Any] = {}

    def _capture(req: httpx.Request) -> httpx.Response:
        captured_body.update(json.loads(req.content))
        return httpx.Response(
            200,
            json={
                "resultCode": "0",
                "resultMsg": "success",
                "resultObject": {"data": [], "degraded_kbs": []},
            },
        )

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/search").mock(side_effect=_capture)
        await s4_client.post(
            f"{_ITEMS_BASE}/search",
            headers={"X-User-Id": "u1"},
            json={
                "knCodeList": [_KN_CODE],
                "query": "test",
                "topK": 5,
                "where": {"eq": {"fieldName": "e2e_search_f", "value": "x"}},
            },
        )

    # The where clause should have been rewritten to backend_name
    assert "where" in captured_body, f"No 'where' in captured body: {captured_body}"
    field_name = captured_body["where"]["eq"]["fieldName"]
    assert field_name.startswith("__byclaw_kgw__"), (
        f"Expected backend_name prefix, got: {field_name}"
    )


async def test_metadatafields_list_returns_synced_properties(s4_client, s4_pool):
    """After a sync row with SYNCED status exists, /metadataFields/list returns the property."""
    from kgw.metadata.registry import get_active_property

    # Create a property
    resp = await s4_client.post(
        f"{_MP_BASE}/create",
        json={"propertyName": "e2e_fields_f", "valueType": "string"},
    )
    assert resp.json()["resultCode"] == "0", resp.json()

    # Look up the property to get its property_id
    prop = await get_active_property(s4_pool, "e2e_fields_f")
    endpoint_key = _KB_BASE_URL

    # Insert SYNCED sync row (simulating post-sync state)
    async with s4_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_sync "
            "(property_id, endpoint_key, sync_status, last_sync_at) "
            "VALUES (%s, %s, 'SYNCED', NOW())",
            (prop.property_id, endpoint_key),
        )
        await conn.commit()

    # Call metadataFields/list — should return the property (no backend HTTP call)
    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        resp = await s4_client.post(
            f"{_ITEMS_BASE}/metadataFields/list",
            json={"knCodeList": [_KN_CODE]},
        )
        assert mock.calls.call_count == 0, "metadataFields/list should not call backend"

    body = resp.json()
    assert body["resultCode"] == "0", body
    names = [item["propertyName"] for item in body["resultObject"]["data"]]
    assert "e2e_fields_f" in names, f"Expected e2e_fields_f in {names}"
