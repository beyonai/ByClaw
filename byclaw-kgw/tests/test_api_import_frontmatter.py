"""Integration tests for markdown front-matter metadata handling on /knowledgeItems/import.

Require real OpenGauss + Redis + MinIO from .env.
Run: uv run pytest -m integration tests/test_api_import_frontmatter.py -v
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

_KN_CODE = "hr_fm"
_RESOURCE_CODE = "backend_hr_fm"
_KB_BASE_URL = "http://kb-fm.test"

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
            "name": "fileImport",
            "path": "/api/v1/knowledgeItems/import",
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
async def _fm_resources(
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
async def fm_client(_fm_resources) -> httpx.AsyncClient:
    client, _ = _fm_resources
    return client


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def fm_pool(_fm_resources):
    _, pool = _fm_resources
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


async def _query_property(pool, property_name: str) -> dict[str, Any] | None:
    """Direct SQL lookup for a property row by name (ACTIVE rows only)."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id, backend_name FROM kgw_metadata_property "
                "WHERE property_name=%s AND status='ACTIVE'",
                (property_name,),
            )
            row = await cur.fetchone()
    if row is None:
        return None
    return {"property_id": row["property_id"], "backend_name": row["backend_name"]}


async def _get_binding_status(
    pool, property_id: int, kn_code: str, file_path: str
) -> str | None:
    """Return the status of a binding row, or None if no row exists."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT status FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
                (property_id, kn_code, file_path),
            )
            row = await cur.fetchone()
    return row["status"] if row else None


def _ok_import_resp(kn_code: str = _RESOURCE_CODE) -> dict[str, Any]:
    """Minimal successful backend import response."""
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"knCode": kn_code},
    }


def _err_import_resp() -> dict[str, Any]:
    """Backend import failure response."""
    return {
        "resultCode": "-1",
        "resultMsg": "backend error",
        "resultObject": {},
    }


def _ok_batch_create_resp() -> dict[str, Any]:
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {},
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_import_markdown_rewrites_frontmatter_fields(fm_client, fm_pool):
    """Uploading a markdown file with front-matter rewrites propertyName keys to backend_name."""
    prop_name = "fm_status"
    await _create_property(fm_client, prop_name, "string")
    prop = await _query_property(fm_pool, prop_name)
    assert prop is not None
    pid = prop["property_id"]
    backend_name = prop["backend_name"]

    file_path = "/docs/employee_fm.md"
    md_content = b"---\nfm_status: active\n---\n\n# Document body\n"

    batch_create_called = False
    import_body_bytes: bytes | None = None

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:

        def capture_batch_create(request):
            nonlocal batch_create_called
            batch_create_called = True
            return httpx.Response(200, json=_ok_batch_create_resp())

        def capture_import(request):
            nonlocal import_body_bytes
            import_body_bytes = request.content
            return httpx.Response(200, json=_ok_import_resp())

        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            side_effect=capture_batch_create
        )
        mock.post("/api/v1/knowledgeItems/import").mock(side_effect=capture_import)

        r = await fm_client.post(
            f"{_ITEMS_BASE}/import",
            files={"fileContent": ("employee_fm.md", md_content, "text/markdown")},
            data={"knCode": _KN_CODE, "filePath": file_path},
            headers={"X-User-Id": "user_fm_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    # lazy sync was called
    assert batch_create_called, "batchCreate (lazy sync) should have been called"

    # The uploaded bytes contain the backend_name, not the original property name as a key
    assert import_body_bytes is not None
    body_bytes = bytes(import_body_bytes)
    assert backend_name.encode() in body_bytes, (
        f"expected backend_name {backend_name!r} in uploaded bytes"
    )
    # The original property name should not appear as a standalone YAML key
    # (it may appear as a substring of the backend_name, so check for key pattern)
    assert b"fm_status:" not in body_bytes, (
        "original property name key should have been rewritten"
    )

    # A BOUND binding row exists
    status = await _get_binding_status(fm_pool, pid, _KN_CODE, file_path)
    assert status == "BOUND", f"expected BOUND binding, got {status!r}"


async def test_import_markdown_no_frontmatter_uses_normal_path(fm_client, fm_pool):
    """Uploading a markdown file without front-matter does not trigger sync or bindings."""
    file_path = "/docs/plain.md"
    md_content = b"# Just a doc\n\nNo front-matter here.\n"

    import_called = False

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:

        def capture_import(request):
            nonlocal import_called
            import_called = True
            return httpx.Response(200, json=_ok_import_resp())

        mock.post("/api/v1/knowledgeItems/import").mock(side_effect=capture_import)
        # batchCreate is NOT mocked — if called it will raise

        r = await fm_client.post(
            f"{_ITEMS_BASE}/import",
            files={"fileContent": ("plain.md", md_content, "text/markdown")},
            data={"knCode": _KN_CODE, "filePath": file_path},
            headers={"X-User-Id": "user_fm_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    assert import_called, "fileImport should have been called"

    # No binding rows created
    async with fm_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                "WHERE kn_code=%s AND file_path=%s",
                (_KN_CODE, file_path),
            )
            row = await cur.fetchone()
    assert int(row["c"]) == 0, "no bindings should have been created for plain markdown"


async def test_import_markdown_unknown_property_returns_error(fm_client):
    """Front-matter with unregistered property name → MetadataPropertyNotFound, no backend call."""
    file_path = "/docs/unknown_field.md"
    md_content = b"---\nunknown_field: value\n---\n\n# body\n"

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False):
        # Nothing mocked — any backend call would raise an error

        r = await fm_client.post(
            f"{_ITEMS_BASE}/import",
            files={"fileContent": ("unknown_field.md", md_content, "text/markdown")},
            data={"knCode": _KN_CODE, "filePath": file_path},
            headers={"X-User-Id": "user_fm_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "-1", body
    assert body["resultObject"]["errorCode"] == "MetadataPropertyNotFound", body


async def test_import_non_markdown_not_processed(fm_client, fm_pool):
    """Non-markdown files pass through unchanged — no batchCreate, no binding rows."""
    file_path = "/docs/report.pdf"
    pdf_content = b"%PDF-1.4 fake pdf bytes"

    import_called = False
    import_body_bytes: bytes | None = None

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:

        def capture_import(request):
            nonlocal import_called, import_body_bytes
            import_called = True
            import_body_bytes = request.content
            return httpx.Response(200, json=_ok_import_resp())

        mock.post("/api/v1/knowledgeItems/import").mock(side_effect=capture_import)
        # batchCreate NOT mocked — must not be called

        r = await fm_client.post(
            f"{_ITEMS_BASE}/import",
            files={"fileContent": ("report.pdf", pdf_content, "application/pdf")},
            data={"knCode": _KN_CODE, "filePath": file_path},
            headers={"X-User-Id": "user_fm_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    assert import_called, "fileImport should have been called"

    # Original PDF bytes should be present in the request
    assert import_body_bytes is not None
    pdf_body = bytes(import_body_bytes)
    assert b"%PDF-1.4 fake pdf bytes" in pdf_body

    # No binding rows
    async with fm_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                "WHERE kn_code=%s AND file_path=%s",
                (_KN_CODE, file_path),
            )
            row = await cur.fetchone()
    assert int(row["c"]) == 0, "no bindings should exist for PDF files"


async def test_import_markdown_binding_rolled_back_on_backend_failure(
    fm_client, fm_pool
):
    """When the backend returns non-zero resultCode, new BOUND bindings are rolled back."""
    prop_name = "fm_rb"
    await _create_property(fm_client, prop_name, "string")
    prop = await _query_property(fm_pool, prop_name)
    assert prop is not None
    pid = prop["property_id"]

    file_path = "/docs/rollback.md"
    md_content = b"---\nfm_rb: x\n---\n\n# Rollback test\n"

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=httpx.Response(200, json=_ok_batch_create_resp())
        )
        mock.post("/api/v1/knowledgeItems/import").mock(
            return_value=httpx.Response(200, json=_err_import_resp())
        )

        r = await fm_client.post(
            f"{_ITEMS_BASE}/import",
            files={"fileContent": ("rollback.md", md_content, "text/markdown")},
            data={"knCode": _KN_CODE, "filePath": file_path},
            headers={"X-User-Id": "user_fm_1"},
        )

    # The response carries the backend's error through
    assert r.status_code == 200, r.text

    # No binding row created by this request should remain
    status = await _get_binding_status(fm_pool, pid, _KN_CODE, file_path)
    assert status is None, (
        f"binding should have been rolled back, but status={status!r}"
    )
