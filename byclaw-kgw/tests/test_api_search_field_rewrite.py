"""Integration tests for read-path metadata field rewrite on search endpoints.

Tests cover:
- /knowledgeItems/search  (knowledgeSearch)
- /knowledgeItems/metadataSearch  (metadataSearch)
- /knowledgeItems/searchFile  (searchFile)

All three endpoints should:
1. Rewrite declared fieldName values in `where` DSL via translate_request_dsl_where.
2. Rewrite `metadataFieldList` entries via translate_request_metadata.
3. Rewrite response `resultObject.data[].metadata` keys via translate_response_metadata.
4. Pass unknown field names through unchanged (best-effort / no MetadataPropertyNotFound).

"No declaration → no remap" invariant:
  If the client sends no `where` fieldName and no `metadataFieldList`, the handler
  has no declared names and therefore builds an empty b2n map. The response is
  returned without any metadata key rewriting. Clients that want propertyName keys
  in the response MUST declare the fields via `metadataFieldList` (or in `where`).

Require real OpenGauss + Redis + MinIO from .env.
Run: uv run pytest -m integration tests/test_api_search_field_rewrite.py -v
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

_KN_CODE = "hr_srf"
_RESOURCE_CODE = "backend_hr_srf"
_KB_BASE_URL = "http://kb-srf.test"

_KB_CONFIG = {
    "resourceCode": _RESOURCE_CODE,
    "domainURL": _KB_BASE_URL,
    "domainName": "",
    "headers": {},
    "resourceService": [
        {
            "name": "knowledgeSearch",
            "path": "/api/v1/knowledgeItems/search",
        },
        {
            "name": "metadataSearch",
            "path": "/api/v1/knowledgeItems/metadataSearch",
        },
        {
            "name": "searchFile",
            "path": "/api/v1/knowledgeItems/searchFile",
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
async def _srf_resources(
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

    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()

    await pool.close()

    try:
        await redis_client.delete(_KB_REDIS_KEY)
    except Exception:  # noqa: BLE001
        pass


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def srf_client(_srf_resources) -> httpx.AsyncClient:
    client, _ = _srf_resources
    return client


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def srf_pool(_srf_resources):
    _, pool = _srf_resources
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
    r = await client.post(
        f"{_MP_BASE}/create",
        json={"propertyName": name, "valueType": value_type},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["resultCode"] == "0", f"create {name} failed: {body}"
    return body["resultObject"]


async def _pid(pool, property_name: str) -> int:
    """Direct SQL lookup for property_id by name (ACTIVE rows only)."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property "
                "WHERE property_name=%s AND status='ACTIVE'",
                (property_name,),
            )
            row = await cur.fetchone()
    assert row is not None, f"property {property_name!r} not found"
    return row["property_id"]


def _fanout_resp(data: list[dict[str, Any]]) -> dict[str, Any]:
    """Minimal successful fanout backend response with data items."""
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"data": data, "degraded_kbs": []},
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_search_dsl_where_fieldname_rewritten(srf_client, srf_pool):
    """fieldName in DSL where is rewritten to backend_name; response metadata translated back."""
    prop_name = "srf_status"
    await _create_property(srf_client, prop_name, "string")
    pid = await _pid(srf_pool, prop_name)
    backend_name = f"__byclaw_kgw__{prop_name}__v{pid}"

    captured_upstream_body: dict[str, Any] = {}

    def _capture(request: httpx.Request) -> httpx.Response:
        captured_upstream_body.update(json.loads(request.content))
        resp_data = [
            {
                "knCode": _RESOURCE_CODE,
                "filePath": "/docs/a.md",
                "metadata": {backend_name: {"valueType": "string", "value": "active"}},
            }
        ]
        return httpx.Response(200, json=_fanout_resp(resp_data))

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/search").mock(side_effect=_capture)

        r = await srf_client.post(
            f"{_ITEMS_BASE}/search",
            json={
                "knCodeList": [_KN_CODE],
                "query": "test",
                "where": {"eq": {"fieldName": prop_name, "value": "active"}},
            },
            headers={"X-User-Id": "user_srf_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    # Upstream received backend_name in DSL
    upstream_where = captured_upstream_body.get("where", {})
    assert upstream_where == {"eq": {"fieldName": backend_name, "value": "active"}}, (
        f"Expected upstream where to use backend_name, got: {upstream_where}"
    )

    # Response data items have propertyName, not backend_name
    data = body["resultObject"]["data"]
    assert len(data) >= 1
    item_meta = data[0]["metadata"]
    assert prop_name in item_meta, f"Expected {prop_name} in metadata, got: {item_meta}"
    assert backend_name not in item_meta, (
        f"backend_name should be remapped; got: {item_meta}"
    )


async def test_search_unknown_fieldname_passes_through(srf_client):
    """Unknown field names (system fields like fileType) pass through unchanged."""
    captured_upstream_body: dict[str, Any] = {}

    def _capture(request: httpx.Request) -> httpx.Response:
        captured_upstream_body.update(json.loads(request.content))
        resp_data = [
            {
                "knCode": _RESOURCE_CODE,
                "filePath": "/docs/b.md",
                "metadata": {"fileType": {"valueType": "string", "value": "md"}},
            }
        ]
        return httpx.Response(200, json=_fanout_resp(resp_data))

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/search").mock(side_effect=_capture)

        r = await srf_client.post(
            f"{_ITEMS_BASE}/search",
            json={
                "knCodeList": [_KN_CODE],
                "query": "test",
                "where": {"eq": {"fieldName": "fileType", "value": "md"}},
            },
            headers={"X-User-Id": "user_srf_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    # Unknown field name passes through unchanged to upstream
    upstream_where = captured_upstream_body.get("where", {})
    assert upstream_where == {"eq": {"fieldName": "fileType", "value": "md"}}, (
        f"Unknown fieldName should pass through, got: {upstream_where}"
    )

    # Response metadata with unknown key passes through unchanged
    data = body["resultObject"]["data"]
    assert len(data) >= 1
    item_meta = data[0]["metadata"]
    assert "fileType" in item_meta, f"Expected fileType in metadata, got: {item_meta}"


async def test_metadata_search_field_list_rewritten(srf_client, srf_pool):
    """metadataFieldList: known fields rewritten to backend names, unknown pass through."""
    prop_name = "srf_tags"
    await _create_property(srf_client, prop_name, "stringList")
    pid = await _pid(srf_pool, prop_name)
    backend_name = f"__byclaw_kgw__{prop_name}__v{pid}"

    captured_upstream_body: dict[str, Any] = {}

    def _capture(request: httpx.Request) -> httpx.Response:
        captured_upstream_body.update(json.loads(request.content))
        resp_data = [
            {
                "knCode": _RESOURCE_CODE,
                "filePath": "/docs/c.md",
                "metadata": {
                    backend_name: {"valueType": "stringList", "value": ["a", "b"]},
                    "fileType": {"valueType": "string", "value": "md"},
                },
            }
        ]
        return httpx.Response(200, json=_fanout_resp(resp_data))

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/metadataSearch").mock(side_effect=_capture)

        r = await srf_client.post(
            f"{_ITEMS_BASE}/metadataSearch",
            json={
                "knCodeList": [_KN_CODE],
                "metadataFieldList": [prop_name, "fileType"],
            },
            headers={"X-User-Id": "user_srf_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    # Upstream sees backend_name for known prop, fileType unchanged
    upstream_field_list = captured_upstream_body.get("metadataFieldList", [])
    assert backend_name in upstream_field_list, (
        f"Known field should be rewritten to backend_name; got: {upstream_field_list}"
    )
    assert "fileType" in upstream_field_list, (
        f"Unknown field fileType should pass through; got: {upstream_field_list}"
    )
    assert prop_name not in upstream_field_list, (
        f"propertyName should be replaced by backend_name; got: {upstream_field_list}"
    )

    # Response metadata: backend_name → propertyName; fileType unchanged
    data = body["resultObject"]["data"]
    assert len(data) >= 1
    item_meta = data[0]["metadata"]
    assert prop_name in item_meta, f"Expected {prop_name} in metadata, got: {item_meta}"
    assert "fileType" in item_meta, f"Expected fileType in metadata, got: {item_meta}"
    assert backend_name not in item_meta, (
        f"backend_name should be remapped; got: {item_meta}"
    )


async def test_search_file_response_metadata_rewrite_only(srf_client, srf_pool):
    """No declaration → no remap invariant.

    When the client sends no `where` fieldName and no `metadataFieldList`, the
    handler builds an empty b2n map (no declared names). The response is returned
    without any metadata key rewriting. Clients that want propertyName keys in the
    response MUST declare the fields (via metadataFieldList or DSL where fieldName).

    This is conservative but correct: rewriting all responses would require a full
    registry pull on every search, which is wasteful for queries that don't care
    about custom metadata field names.
    """
    prop_name = "srf_owner"
    await _create_property(srf_client, prop_name, "string")
    pid = await _pid(srf_pool, prop_name)
    backend_name = f"__byclaw_kgw__{prop_name}__v{pid}"

    def _capture(_request: httpx.Request) -> httpx.Response:
        resp_data = [
            {
                "knCode": _RESOURCE_CODE,
                "filePath": "/docs/d.md",
                "metadata": {backend_name: {"valueType": "string", "value": "alice"}},
            }
        ]
        return httpx.Response(200, json=_fanout_resp(resp_data))

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/searchFile").mock(side_effect=_capture)

        r = await srf_client.post(
            f"{_ITEMS_BASE}/searchFile",
            json={
                "knCodeList": [_KN_CODE],
                "query": "test",
                # no `where`, no `metadataFieldList` — no field declarations
            },
            headers={"X-User-Id": "user_srf_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    # No declaration → no remap: backend_name should appear unchanged in response
    data = body["resultObject"]["data"]
    assert len(data) >= 1
    item_meta = data[0]["metadata"]
    assert backend_name in item_meta, (
        f"Without declaration, backend_name should pass through unchanged; "
        f"got: {item_meta}"
    )
    assert prop_name not in item_meta, (
        f"Without declaration, propertyName should NOT appear; got: {item_meta}"
    )


async def test_search_dsl_nested_where_fieldname_rewritten(srf_client, srf_pool):
    """Nested DSL AST: known fields rewritten at every depth, unknown pass through."""
    prop_a = "srf_a"
    prop_b = "srf_b"
    await _create_property(srf_client, prop_a, "string")
    await _create_property(srf_client, prop_b, "string")
    pid_a = await _pid(srf_pool, prop_a)
    pid_b = await _pid(srf_pool, prop_b)
    bn_a = f"__byclaw_kgw__{prop_a}__v{pid_a}"
    bn_b = f"__byclaw_kgw__{prop_b}__v{pid_b}"

    captured_upstream_body: dict[str, Any] = {}

    def _capture(request: httpx.Request) -> httpx.Response:
        captured_upstream_body.update(json.loads(request.content))
        return httpx.Response(200, json=_fanout_resp([]))

    nested_where = {
        "and": [
            {"eq": {"fieldName": prop_a, "value": "1"}},
            {
                "or": [
                    {"eq": {"fieldName": prop_b, "value": "2"}},
                    {"eq": {"fieldName": "fileType", "value": "md"}},
                ]
            },
        ]
    }
    expected_where = {
        "and": [
            {"eq": {"fieldName": bn_a, "value": "1"}},
            {
                "or": [
                    {"eq": {"fieldName": bn_b, "value": "2"}},
                    {"eq": {"fieldName": "fileType", "value": "md"}},
                ]
            },
        ]
    }

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/search").mock(side_effect=_capture)

        r = await srf_client.post(
            f"{_ITEMS_BASE}/search",
            json={
                "knCodeList": [_KN_CODE],
                "query": "test",
                "where": nested_where,
            },
            headers={"X-User-Id": "user_srf_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    upstream_where = captured_upstream_body.get("where", {})
    assert upstream_where == expected_where, (
        f"Nested DSL fields not rewritten correctly.\n"
        f"Expected: {expected_where}\n"
        f"Got:      {upstream_where}"
    )
