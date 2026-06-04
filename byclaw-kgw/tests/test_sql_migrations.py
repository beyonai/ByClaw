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
        applied = await run_migrations(pool, SQL_DIR)
        assert "001_kgw_audit_log.sql" in applied
        assert "002_kgw_kb_write_history.sql" in applied
        assert "003_kgw_kb_source_lock.sql" in applied
        assert "004_kgw_kb_conflict_log.sql" in applied

        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_audit_log') AS audit,
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_kb_write_history') AS history,
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_kb_source_lock') AS lock,
                    (SELECT COUNT(*) FROM information_schema.tables
                     WHERE table_name = 'kgw_kb_conflict_log') AS conflict
                """
            )
            row = await cur.fetchone()
            assert row["audit"] >= 1
            assert row["history"] >= 1
            assert row["lock"] >= 1
            assert row["conflict"] >= 1
    finally:
        async with pool.connection() as conn:
            for table in (
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
                "kgw_kb_write_history",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()
