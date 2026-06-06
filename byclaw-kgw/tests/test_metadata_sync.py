from __future__ import annotations

from pathlib import Path

import pytest
import respx
from httpx import Response
from kgw.db import build_pool, run_migrations
from kgw.envelope import MetadataPropertySyncFailed
from kgw.http_client import build_http_client
from kgw.metadata.registry import create_property
from kgw.metadata.sync import (
    SyncStatus,
    ensure_synced,
    get_sync_status,
    list_synced_property_ids_for_kn,
    upsert_purging_for_synced,
)

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"

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


async def _cleanup(pool) -> None:
    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()
    await pool.close()


async def test_first_use_creates_synced_row(pg_dsn: str, kb_config_resolver_factory):
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    http = build_http_client(timeout_seconds=15.0, max_connections=10, max_keepalive=5)
    try:
        await run_migrations(pool, SQL_DIR)
        p = await create_property(pool, property_name="t_sync1", value_type="string")
        resolver = kb_config_resolver_factory({"hr": "http://kb-hr.test"})
        with respx.mock(base_url="http://kb-hr.test") as mock:
            mock.post("/api/v1/metadataProperties/batchCreate").mock(
                return_value=Response(
                    200,
                    json={
                        "resultCode": "0",
                        "resultMsg": "success",
                        "resultObject": {},
                    },
                )
            )
            await ensure_synced(
                pool, http, resolver, property_id=p.property_id, kn_code="hr"
            )
        status = await get_sync_status(pool, p.property_id, "hr")
        assert status == SyncStatus.SYNCED
    finally:
        await http.aclose()
        await _cleanup(pool)


async def test_backend_failure_marks_failed(pg_dsn: str, kb_config_resolver_factory):
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    http = build_http_client(timeout_seconds=15.0, max_connections=10, max_keepalive=5)
    try:
        await run_migrations(pool, SQL_DIR)
        p = await create_property(pool, property_name="t_sync2", value_type="string")
        resolver = kb_config_resolver_factory({"hr": "http://kb-hr.test"})
        with respx.mock(base_url="http://kb-hr.test") as mock:
            mock.post("/api/v1/metadataProperties/batchCreate").mock(
                return_value=Response(500, json={})
            )
            with pytest.raises(MetadataPropertySyncFailed):
                await ensure_synced(
                    pool, http, resolver, property_id=p.property_id, kn_code="hr"
                )
        status = await get_sync_status(pool, p.property_id, "hr")
        assert status == SyncStatus.FAILED
    finally:
        await http.aclose()
        await _cleanup(pool)


async def test_idempotent_when_already_synced(pg_dsn: str, kb_config_resolver_factory):
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    http = build_http_client(timeout_seconds=15.0, max_connections=10, max_keepalive=5)
    try:
        await run_migrations(pool, SQL_DIR)
        p = await create_property(pool, property_name="t_sync3", value_type="string")
        # Manually insert a SYNCED row
        async with pool.connection() as conn:
            await conn.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, kn_code, sync_status, last_sync_at, last_error) "
                "VALUES (%s, 'hr', 'SYNCED', NOW(), NULL)",
                (p.property_id,),
            )
            await conn.commit()
        resolver = kb_config_resolver_factory({"hr": "http://kb-hr.test"})
        with respx.mock(base_url="http://kb-hr.test") as mock:
            # No expected calls — backend must NOT be hit
            await ensure_synced(
                pool, http, resolver, property_id=p.property_id, kn_code="hr"
            )
            assert mock.calls.call_count == 0
        status = await get_sync_status(pool, p.property_id, "hr")
        assert status == SyncStatus.SYNCED
    finally:
        await http.aclose()
        await _cleanup(pool)


async def test_upsert_purging_for_synced_flips_and_deletes(pg_dsn: str):
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)
        p = await create_property(pool, property_name="t_sync4", value_type="string")
        # Insert three sync rows
        async with pool.connection() as conn:
            for kn_code, sync_status in [
                ("hr", "SYNCED"),
                ("eng", "FAILED"),
                ("legal", "SYNCING"),
            ]:
                await conn.execute(
                    "INSERT INTO kgw_metadata_property_sync "
                    "(property_id, kn_code, sync_status, last_sync_at, last_error) "
                    "VALUES (%s, %s, %s, NOW(), NULL)",
                    (p.property_id, kn_code, sync_status),
                )
            await conn.commit()
        # Call upsert_purging_for_synced inside a transaction
        async with pool.connection() as conn:
            async with conn.transaction():
                await upsert_purging_for_synced(conn, p.property_id)
        # Verify: hr → PURGING, eng + legal deleted
        hr_status = await get_sync_status(pool, p.property_id, "hr")
        assert hr_status == SyncStatus.PURGING
        eng_status = await get_sync_status(pool, p.property_id, "eng")
        assert eng_status is None
        legal_status = await get_sync_status(pool, p.property_id, "legal")
        assert legal_status is None
        # list_synced_property_ids_for_kn should not return this property
        synced_ids = await list_synced_property_ids_for_kn(pool, "hr")
        assert p.property_id not in synced_ids
    finally:
        await _cleanup(pool)
