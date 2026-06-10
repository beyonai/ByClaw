from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"


@pytest.mark.integration
async def test_s1_migrations_create_expected_tables(pg_dsn: str):
    from kgw.db import build_pool, run_migrations

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)

        async with pool.connection() as conn:
            cur = await conn.execute("SELECT filename FROM kgw_migration")
            recorded = {row["filename"] for row in await cur.fetchall()}
        assert "001_kgw_audit_log.sql" in recorded
        assert "003_kgw_kb_source_lock.sql" in recorded
        assert "004_kgw_kb_conflict_log.sql" in recorded

        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_audit_log'
                       AND table_schema = current_schema()) AS audit,
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_kb_source_lock'
                       AND table_schema = current_schema()) AS lock,
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_kb_conflict_log'
                       AND table_schema = current_schema()) AS conflict
                """
            )
            row = await cur.fetchone()
            assert row["audit"] >= 1
            assert row["lock"] >= 1
            assert row["conflict"] >= 1
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_audit_log",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_audit_log_columns_present(pg_dsn: str):
    from kgw.db import build_pool, run_migrations

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'kgw_audit_log'
                  AND table_schema = current_schema()
                """
            )
            cols = {row["column_name"] for row in await cur.fetchall()}
        for required in (
            "id",
            "source",
            "trace_id",
            "actor_user_id",
            "actor_kind",
            "operation_type",
            "kn_code",
            "file_path",
            "result_code",
            "latency_ms",
            "created_at",
        ):
            assert required in cols, f"missing column {required}"
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_audit_log",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_s4_migrations_create_expected_tables(pg_dsn: str):
    from kgw.db import build_pool, run_migrations

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)

        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_metadata_property'
                       AND table_schema = current_schema()) AS prop,
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_metadata_property_binding'
                       AND table_schema = current_schema()) AS binding,
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_metadata_binding_outbox'
                       AND table_schema = current_schema()) AS outbox,
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_metadata_property_sync'
                       AND table_schema = current_schema()) AS sync
                """
            )
            row = await cur.fetchone()
            assert row["prop"] >= 1
            assert row["binding"] >= 1
            assert row["outbox"] >= 1
            assert row["sync"] >= 1
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_metadata_property_sync",
                "kgw_metadata_property_binding",
                "kgw_metadata_binding_outbox",
                "kgw_metadata_property",
                "kgw_audit_log",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()
