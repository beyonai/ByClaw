"""Integration tests for binding cleanup on file/directory delete.

Tests cover:
- /knowledgeItems/delete (fileDelete): on success, calls binding_mod.delete_by_file
- /directories/delete (directoryDelete): on success, calls binding_mod.delete_by_directory

Binding cleanup only happens on backend success (resultCode == "0"). On non-success,
bindings are left untouched.

Require real OpenGauss + Redis + MinIO from .env.
Run: uv run pytest -m integration tests/test_api_write_binding_cleanup.py -v
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

_KN_CODE = "hr_bc"
_RESOURCE_CODE = "backend_hr_bc"
_KB_BASE_URL = "http://kb-bc.test"

_KB_CONFIG = {
    "resourceCode": _RESOURCE_CODE,
    "domainURL": _KB_BASE_URL,
    "domainName": "",
    "headers": {},
    "resourceService": [
        {
            "name": "fileDelete",
            "path": "/api/v1/knowledgeItems/delete",
        },
        {
            "name": "directoryDelete",
            "path": "/api/v1/directories/delete",
        },
    ],
}

_KB_MINIO_KEY = f"resource/doc/KG_DOC_{_KN_CODE}.json"

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
async def _bc_resources(
    pg_dsn,
    redis_url,
    minio_settings,
) -> AsyncIterator[tuple[httpx.AsyncClient, Any]]:
    """Build real app wired to DB+Redis; seed KB config in MinIO; yield (client, pool)."""
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
async def bc_client(_bc_resources) -> httpx.AsyncClient:
    client, _ = _bc_resources
    return client


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def bc_pool(_bc_resources):
    _, pool = _bc_resources
    return pool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MP_BASE = "/kgw/api/v1/metadataProperties"
_ITEMS_BASE = "/kgw/api/v1/knowledgeItems"
_DIRS_BASE = "/kgw/api/v1/directories"


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


async def _insert_synced_binding(
    pool, *, property_id: int, kn_code: str, file_path: str
) -> None:
    """Manually INSERT a SYNCED binding row for test setup."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
                "VALUES (%s, %s, %s, 'SYNCED', 1, NOW())",
                (property_id, kn_code, file_path),
            )
        await conn.commit()


async def _count_in_use(pool, property_id: int) -> int:
    """Count PENDING or SYNCED rows for property_id."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND status IN ('PENDING','SYNCED')",
                (property_id,),
            )
            row = await cur.fetchone()
    return int(row["c"])


async def _count_by_file(pool, property_id: int, kn_code: str, file_path: str) -> int:
    """Count binding rows for a specific (property_id, kn_code, file_path)."""
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
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"knCode": kn_code},
    }


def _err_resp() -> dict[str, Any]:
    return {
        "resultCode": "-1",
        "resultMsg": "fail",
        "resultObject": {"errorCode": "Backend"},
    }


# ---------------------------------------------------------------------------
# Tests: /knowledgeItems/delete
# ---------------------------------------------------------------------------


async def test_file_delete_clears_bindings_when_backend_succeeds(bc_client, bc_pool):
    """On backend success, binding rows for the deleted file are removed."""
    await _create_property(bc_client, "bc_x", "string")
    pid = await _pid(bc_pool, "bc_x")
    file_path = "/d.md"

    await _insert_synced_binding(
        bc_pool, property_id=pid, kn_code=_KN_CODE, file_path=file_path
    )
    assert await _count_in_use(bc_pool, pid) == 1

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )

        r = await bc_client.post(
            f"{_ITEMS_BASE}/delete",
            json={"knCode": _KN_CODE, "filePath": file_path},
            headers={"X-User-Id": "user_bc_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    assert await _count_in_use(bc_pool, pid) == 0, (
        "Binding should be deleted on success"
    )


async def test_file_delete_keeps_bindings_when_backend_fails(bc_client, bc_pool):
    """On backend failure, binding rows are NOT deleted."""
    await _create_property(bc_client, "bc_fail", "string")
    pid = await _pid(bc_pool, "bc_fail")
    file_path = "/fail.md"

    await _insert_synced_binding(
        bc_pool, property_id=pid, kn_code=_KN_CODE, file_path=file_path
    )
    assert await _count_in_use(bc_pool, pid) == 1

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json=_err_resp())
        )

        r = await bc_client.post(
            f"{_ITEMS_BASE}/delete",
            json={"knCode": _KN_CODE, "filePath": file_path},
            headers={"X-User-Id": "user_bc_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "-1", body

    assert await _count_in_use(bc_pool, pid) == 1, "Binding should be intact on failure"


async def test_file_delete_ignores_other_files_bindings(bc_client, bc_pool):
    """Deleting /d1.md removes its binding but leaves /d2.md binding untouched."""
    await _create_property(bc_client, "bc_multi", "string")
    pid = await _pid(bc_pool, "bc_multi")
    file1 = "/d1.md"
    file2 = "/d2.md"

    await _insert_synced_binding(
        bc_pool, property_id=pid, kn_code=_KN_CODE, file_path=file1
    )
    await _insert_synced_binding(
        bc_pool, property_id=pid, kn_code=_KN_CODE, file_path=file2
    )
    assert await _count_in_use(bc_pool, pid) == 2

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )

        r = await bc_client.post(
            f"{_ITEMS_BASE}/delete",
            json={"knCode": _KN_CODE, "filePath": file1},
            headers={"X-User-Id": "user_bc_1"},
        )

    assert r.json()["resultCode"] == "0", r.json()

    assert await _count_by_file(bc_pool, pid, _KN_CODE, file1) == 0, (
        f"{file1} binding should be deleted"
    )
    assert await _count_by_file(bc_pool, pid, _KN_CODE, file2) == 1, (
        f"{file2} binding should survive"
    )


# ---------------------------------------------------------------------------
# Tests: /directories/delete
# ---------------------------------------------------------------------------


async def test_directory_delete_clears_directory_bindings(bc_client, bc_pool):
    """On directory delete success, all bindings under the directory are removed."""
    await _create_property(bc_client, "bc_dir", "string")
    pid = await _pid(bc_pool, "bc_dir")

    await _insert_synced_binding(
        bc_pool, property_id=pid, kn_code=_KN_CODE, file_path="/dir/a.md"
    )
    await _insert_synced_binding(
        bc_pool, property_id=pid, kn_code=_KN_CODE, file_path="/dir/sub/b.md"
    )
    await _insert_synced_binding(
        bc_pool, property_id=pid, kn_code=_KN_CODE, file_path="/other/c.md"
    )
    assert await _count_in_use(bc_pool, pid) == 3

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/directories/delete").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )

        r = await bc_client.post(
            f"{_DIRS_BASE}/delete",
            json={"knCode": _KN_CODE, "directoryPath": "/dir"},
            headers={"X-User-Id": "user_bc_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "0", body

    assert await _count_by_file(bc_pool, pid, _KN_CODE, "/dir/a.md") == 0, (
        "/dir/a.md binding should be deleted"
    )
    assert await _count_by_file(bc_pool, pid, _KN_CODE, "/dir/sub/b.md") == 0, (
        "/dir/sub/b.md binding should be deleted"
    )
    assert await _count_by_file(bc_pool, pid, _KN_CODE, "/other/c.md") == 1, (
        "/other/c.md binding should survive"
    )


async def test_directory_delete_keeps_bindings_when_backend_fails(bc_client, bc_pool):
    """On directory delete failure, bindings are NOT deleted."""
    await _create_property(bc_client, "bc_dir_fail", "string")
    pid = await _pid(bc_pool, "bc_dir_fail")

    await _insert_synced_binding(
        bc_pool, property_id=pid, kn_code=_KN_CODE, file_path="/faildir/x.md"
    )
    assert await _count_in_use(bc_pool, pid) == 1

    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/directories/delete").mock(
            return_value=httpx.Response(200, json=_err_resp())
        )

        r = await bc_client.post(
            f"{_DIRS_BASE}/delete",
            json={"knCode": _KN_CODE, "directoryPath": "/faildir"},
            headers={"X-User-Id": "user_bc_1"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resultCode"] == "-1", body

    assert await _count_in_use(bc_pool, pid) == 1, (
        "Binding should be intact when backend fails"
    )


async def test_file_delete_with_empty_file_path_does_not_crash(bc_client):
    """Smoke test: no filePath in body → no crash, response received.

    The `if file_path:` guard prevents binding cleanup on empty path.
    The backend may or may not succeed, but the gateway should not raise.
    """
    with respx.mock(base_url=_KB_BASE_URL, assert_all_called=False) as mock:
        mock.post("/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json=_err_resp())
        )

        r = await bc_client.post(
            f"{_ITEMS_BASE}/delete",
            json={"knCode": _KN_CODE},  # no filePath
            headers={"X-User-Id": "user_bc_1"},
        )

    # Should not raise — either the backend returns failure or validation rejects it
    assert r.status_code == 200, r.text
    # Just verify a valid JSON response is returned
    body = r.json()
    assert "resultCode" in body, f"Expected resultCode in response: {body}"
