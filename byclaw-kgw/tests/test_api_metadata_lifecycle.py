"""Integration tests for metadata/update + metadata/get + metadataFields/list.

Require real OpenGauss + Redis + MinIO from .env.
Run: uv run pytest -m integration tests/test_api_metadata_lifecycle.py -v
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

_KN_CODE = "hr_lc"
_RESOURCE_CODE = "backend_hr_lc"
_KB_BASE_URL = "http://kb-hr.test"

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
    ],
}

_KB_REDIS_KEY = f"KG_DOC_{_KN_CODE}"

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
async def _lc_resources(
    pg_dsn,
    redis_url,
) -> AsyncIterator[tuple[httpx.AsyncClient, Any]]:
    """Build real app wired to DB+Redis; seed KB config in Redis; yield (client, pool)."""
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

    # Cleanup Redis KB config
    try:
        await redis_client.delete(_KB_REDIS_KEY)
    except Exception:  # noqa: BLE001
        pass


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def lc_client(_lc_resources) -> httpx.AsyncClient:
    client, _ = _lc_resources
    return client


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def lc_pool(_lc_resources):
    _, pool = _lc_resources
    return pool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MP_BASE = "/kgw/api/v1/metadataProperties"
_ITEMS_BASE = "/kgw/api/v1/knowledgeItems"


async def _create_property(
    client: httpx.AsyncClient,
    name: str,
    value_type: str = "string",
) -> dict[str, Any]:
    """Create a metadata property and assert success."""
    r = await client.post(
        f"{_MP_BASE}/create",
        json={"propertyName": name, "valueType": value_type},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", f"create {name} failed: {body}"
    return body["resultObject"]


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


async def _count_bindings(pool, property_id: int, kn_code: str, file_path: str) -> int:
    """Count binding rows of any status for a specific (property_id, kn_code, file_path)."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
                (property_id, kn_code, file_path),
            )
            row = await cur.fetchone()
    return int(row["c"])


def _ok_resp(kn_code: str = _RESOURCE_CODE) -> dict[str, Any]:
    """Minimal successful backend response."""
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"knCode": kn_code},
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_full_lifecycle_create_use_delete_recreate(lc_client, lc_pool):
    """Create lc_status, update it, then delete should fail (MetadataPropertyInUse)."""
    prop_name = "lc_status"

    await _create_property(lc_client, prop_name, "string")
    pid = await _query_property_id(lc_pool, prop_name)
    assert pid is not None

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )

        r = await lc_client.post(
            f"{_ITEMS_BASE}/metadata/update",
            json={
                "knCode": _KN_CODE,
                "filePath": "/docs/employee.md",
                "operationList": [
                    {"propertyName": prop_name, "operation": "set", "value": "active"}
                ],
            },
            headers={"X-User-Id": "user_lc_1"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    # Now delete should fail with MetadataPropertyInUse
    r_del = await lc_client.post(
        f"{_MP_BASE}/delete",
        json={"propertyName": prop_name},
    )
    assert r_del.status_code == 200
    del_body = r_del.json()
    assert del_body["resultCode"] == "-1", del_body
    assert del_body["resultObject"]["errorCode"] == "MetadataPropertyInUse"


async def test_delete_property_rejects_deleting_binding(lc_client, lc_pool):
    prop_name = "delete_blocked_deleting"

    await _create_property(lc_client, prop_name, "string")
    pid = await _query_property_id(lc_pool, prop_name)
    assert pid is not None

    async with lc_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, bound_at, updated_at) "
            "VALUES (%s, 'hr', '/docs/in-use.md', 'DELETING', NOW(), NOW())",
            (pid,),
        )
        await conn.commit()

    resp = await lc_client.post(
        f"{_MP_BASE}/delete",
        headers={"X-User-Id": "tester"},
        json={"propertyName": prop_name},
    )

    body = resp.json()
    assert body["resultCode"] != "0", body
    assert body["resultObject"]["errorCode"] == "MetadataPropertyInUse"


async def test_unset_releases_binding_then_delete_passes(lc_client, lc_pool):
    """Set then unset a property — binding removed, delete succeeds afterward."""
    prop_name = "lc_unset"

    await _create_property(lc_client, prop_name, "string")
    pid = await _query_property_id(lc_pool, prop_name)
    assert pid is not None
    file_path = "/docs/unset.md"

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )

        # First call: set
        r_set = await lc_client.post(
            f"{_ITEMS_BASE}/metadata/update",
            json={
                "knCode": _KN_CODE,
                "filePath": file_path,
                "operationList": [
                    {"propertyName": prop_name, "operation": "set", "value": "hello"}
                ],
            },
            headers={"X-User-Id": "user_lc_1"},
        )
    assert r_set.json()["resultCode"] == "0", r_set.json()

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )

        # Second call: unset
        r_unset = await lc_client.post(
            f"{_ITEMS_BASE}/metadata/update",
            json={
                "knCode": _KN_CODE,
                "filePath": file_path,
                "operationList": [{"propertyName": prop_name, "operation": "unset"}],
            },
            headers={"X-User-Id": "user_lc_1"},
        )
    assert r_unset.json()["resultCode"] == "0", r_unset.json()

    # Binding should be gone
    count = await _count_bindings(lc_pool, pid, _KN_CODE, file_path)
    assert count == 0

    # Delete should now succeed (no binding)
    r_del = await lc_client.post(
        f"{_MP_BASE}/delete",
        json={"propertyName": prop_name},
    )
    assert r_del.json()["resultCode"] == "0", r_del.json()


async def test_metadata_update_unknown_property_returns_not_found(lc_client):
    """Requesting an unknown propertyName → MetadataPropertyNotFound (no backend call)."""
    r = await lc_client.post(
        f"{_ITEMS_BASE}/metadata/update",
        json={
            "knCode": _KN_CODE,
            "filePath": "/docs/x.md",
            "operationList": [
                {"propertyName": "never_declared", "operation": "set", "value": "v"}
            ],
        },
        headers={"X-User-Id": "user_lc_1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "MetadataPropertyNotFound"


async def test_metadata_update_invalid_operation_for_type(lc_client):
    """'append' on a string property → INVALID_OPERATION_FOR_TYPE."""
    prop_name = "lc_inv_op"
    await _create_property(lc_client, prop_name, "string")

    r = await lc_client.post(
        f"{_ITEMS_BASE}/metadata/update",
        json={
            "knCode": _KN_CODE,
            "filePath": "/docs/inv.md",
            "operationList": [
                {"propertyName": prop_name, "operation": "append", "value": "v"}
            ],
        },
        headers={"X-User-Id": "user_lc_1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "INVALID_OPERATION_FOR_TYPE"


async def test_metadata_update_backend_error_rolls_back_pending(lc_client, lc_pool):
    """When backend returns resultCode '-1', client receives passthrough; no PENDING binding survives."""
    prop_name = "lc_rb"
    file_path = "/docs/rb.md"

    await _create_property(lc_client, prop_name, "string")
    pid = await _query_property_id(lc_pool, prop_name)
    assert pid is not None

    backend_err = {
        "resultCode": "-1",
        "resultMsg": "backend error",
        "resultObject": {"errorCode": "Backend"},
    }

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=httpx.Response(200, json=backend_err)
        )

        r = await lc_client.post(
            f"{_ITEMS_BASE}/metadata/update",
            json={
                "knCode": _KN_CODE,
                "filePath": file_path,
                "operationList": [
                    {"propertyName": prop_name, "operation": "set", "value": "x"}
                ],
            },
            headers={"X-User-Id": "user_lc_1"},
        )

    assert r.status_code == 200
    body = r.json()
    # Passthrough: backend's envelope
    assert body["resultCode"] == "-1", body

    # No PENDING binding should survive
    count = await _count_bindings(lc_pool, pid, _KN_CODE, file_path)
    assert count == 0, f"Expected 0 pending bindings, got {count}"


async def test_metadata_update_response_field_names_translated_back(lc_client, lc_pool):
    """Backend backend_name keys in response.metadata → propertyName keys in client response."""
    prop_name = "lc_resp"
    file_path = "/docs/resp.md"

    await _create_property(lc_client, prop_name, "string")
    pid = await _query_property_id(lc_pool, prop_name)
    assert pid is not None

    # Derive the backend_name the same way registry.derive_backend_name does
    backend_name = f"__byclaw_kgw__{prop_name}__v{pid}"

    backend_resp = {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "knCode": _RESOURCE_CODE,
            "filePath": file_path,
            "metadata": {backend_name: {"valueType": "string", "value": "X"}},
        },
    }

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=httpx.Response(200, json=backend_resp)
        )

        r = await lc_client.post(
            f"{_ITEMS_BASE}/metadata/update",
            json={
                "knCode": _KN_CODE,
                "filePath": file_path,
                "operationList": [
                    {"propertyName": prop_name, "operation": "set", "value": "X"}
                ],
            },
            headers={"X-User-Id": "user_lc_1"},
        )

    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body
    ro = body["resultObject"]
    # knCode reverse-mapped to portal kn_code
    assert ro["knCode"] == _KN_CODE, ro
    # metadata keyed on propertyName, not backend_name
    assert prop_name in ro["metadata"], ro
    assert ro["metadata"][prop_name] == {"valueType": "string", "value": "X"}


async def test_metadata_get_translates_field_list_and_response(lc_client, lc_pool):
    """metadata/get: metadataFieldList translated to backend names; response translated back."""
    prop_a = "lc_get_a"
    prop_b = "lc_get_b"

    await _create_property(lc_client, prop_a, "string")
    await _create_property(lc_client, prop_b, "number")

    pid_a = await _query_property_id(lc_pool, prop_a)
    pid_b = await _query_property_id(lc_pool, prop_b)
    assert pid_a is not None and pid_b is not None

    bn_a = f"__byclaw_kgw__{prop_a}__v{pid_a}"
    bn_b = f"__byclaw_kgw__{prop_b}__v{pid_b}"

    backend_resp = {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "knCode": _RESOURCE_CODE,
            "filePath": "/docs/get.md",
            "metadata": {
                bn_a: {"valueType": "string", "value": "hello"},
                bn_b: {"valueType": "number", "value": 42},
            },
        },
    }

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/metadata/get").mock(
            return_value=httpx.Response(200, json=backend_resp)
        )

        r = await lc_client.post(
            f"{_ITEMS_BASE}/metadata/get",
            json={
                "knCode": _KN_CODE,
                "filePath": "/docs/get.md",
                "metadataFieldList": [prop_a, prop_b],
            },
            headers={"X-User-Id": "user_lc_1"},
        )

    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body
    ro = body["resultObject"]
    assert ro["knCode"] == _KN_CODE, ro
    assert prop_a in ro["metadata"], ro
    assert prop_b in ro["metadata"], ro
    assert ro["metadata"][prop_a] == {"valueType": "string", "value": "hello"}
    assert ro["metadata"][prop_b] == {"valueType": "number", "value": 42}


async def test_metadata_fields_list_local_only(lc_client, lc_pool):
    """metadataFields/list returns only properties with SYNCED rows in kgw_metadata_property_sync."""
    # Create three properties, manually insert sync row only for lc_f3
    prop_f1 = "lc_f1"
    prop_f2 = "lc_f2"
    prop_f3 = "lc_f3"

    await _create_property(lc_client, prop_f1, "string")
    await _create_property(lc_client, prop_f2, "string")
    await _create_property(lc_client, prop_f3, "string")

    pid_f3 = await _query_property_id(lc_pool, prop_f3)
    assert pid_f3 is not None

    # Manually INSERT a SYNCED row for lc_f3 using endpoint_key
    async with lc_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, endpoint_key, sync_status, last_sync_at) "
                "VALUES (%s, %s, 'SYNCED', NOW())",
                (pid_f3, _KB_BASE_URL),
            )
        await conn.commit()

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        r = await lc_client.post(
            f"{_ITEMS_BASE}/metadataFields/list",
            json={"knCodeList": [_KN_CODE]},
            headers={"X-User-Id": "user_lc_1"},
        )
        # Assert no backend HTTP calls were made
        assert mock.calls.call_count == 0, "metadataFields/list should not call backend"

    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body
    data = body["resultObject"]["data"]
    names = [item["propertyName"] for item in data]
    assert prop_f3 in names, f"Expected lc_f3 in {names}"
    assert prop_f1 not in names, f"lc_f1 should not be in {names}"
    assert prop_f2 not in names, f"lc_f2 should not be in {names}"


async def test_metadata_update_empty_op_list_short_circuits(lc_client):
    """Empty operationList → resultCode 0 immediately, no backend call."""
    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        r = await lc_client.post(
            f"{_ITEMS_BASE}/metadata/update",
            json={
                "knCode": _KN_CODE,
                "filePath": "/docs/empty.md",
                "operationList": [],
            },
            headers={"X-User-Id": "user_lc_1"},
        )
        assert mock.calls.call_count == 0, "Empty op_list should not call backend"

    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", body
