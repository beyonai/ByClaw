from __future__ import annotations

from pathlib import Path

import pytest
from kgw.db import build_pool, run_migrations
from kgw.envelope import MetadataPropertyAlreadyExists, MetadataPropertyNotFound
from kgw.metadata.registry import (
    MetadataProperty,
    create_property,
    delete_property_to_deleted,
    derive_backend_name,
    get_active_property,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"


def test_derive_backend_name_format():
    assert derive_backend_name("status", 7) == "__byclaw_kgw__status__v7"
    assert derive_backend_name("a_b", 12345) == "__byclaw_kgw__a_b__v12345"


@pytest.mark.integration
async def test_create_then_get_active(pg_dsn: str):
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)
        p = await create_property(
            pool,
            property_name="t_status",
            value_type="string",
            description="d",
            ext_params={"k": "v"},
        )
        assert p.property_name == "t_status"
        assert p.backend_name == f"__byclaw_kgw__t_status__v{p.property_id}"
        assert isinstance(p, MetadataProperty)
        got = await get_active_property(pool, "t_status")
        assert got.property_id == p.property_id
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_metadata_property_sync",
                "kgw_metadata_property_binding",
                "kgw_metadata_binding_outbox",
                "kgw_metadata_property",
                "kgw_audit_log",
                "kgw_kb_write_history",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_create_duplicate_active_raises(pg_dsn: str):
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)
        await create_property(pool, property_name="t_dup", value_type="string")
        with pytest.raises(MetadataPropertyAlreadyExists):
            await create_property(pool, property_name="t_dup", value_type="number")
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_metadata_property_sync",
                "kgw_metadata_property_binding",
                "kgw_metadata_binding_outbox",
                "kgw_metadata_property",
                "kgw_audit_log",
                "kgw_kb_write_history",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_delete_then_recreate_same_name(pg_dsn: str):
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)
        p1 = await create_property(
            pool, property_name="t_recreate", value_type="string"
        )
        await delete_property_to_deleted(pool, p1.property_id)
        p2 = await create_property(
            pool, property_name="t_recreate", value_type="number"
        )
        assert p2.property_id != p1.property_id
        assert p2.backend_name != p1.backend_name
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_metadata_property_sync",
                "kgw_metadata_property_binding",
                "kgw_metadata_binding_outbox",
                "kgw_metadata_property",
                "kgw_audit_log",
                "kgw_kb_write_history",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_get_active_missing_raises(pg_dsn: str):
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)
        with pytest.raises(MetadataPropertyNotFound):
            await get_active_property(pool, "t_missing")
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_metadata_property_sync",
                "kgw_metadata_property_binding",
                "kgw_metadata_binding_outbox",
                "kgw_metadata_property",
                "kgw_audit_log",
                "kgw_kb_write_history",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()
