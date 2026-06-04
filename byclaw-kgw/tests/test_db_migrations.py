from __future__ import annotations

from pathlib import Path

import pytest


@pytest.mark.integration
async def test_migration_runner_applies_files_once(pg_dsn: str, tmp_path: Path):
    from kgw.db import build_pool, run_migrations

    sql_dir = tmp_path / "sql"
    sql_dir.mkdir()
    (sql_dir / "001_users.sql").write_text(
        "CREATE TABLE kgw_test_users (id INT PRIMARY KEY, name TEXT);"
    )
    (sql_dir / "002_orders.sql").write_text(
        "CREATE TABLE kgw_test_orders (id INT PRIMARY KEY, user_id INT);"
    )

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        applied = await run_migrations(pool, sql_dir)
        assert applied == ["001_users.sql", "002_orders.sql"]

        applied = await run_migrations(pool, sql_dir)
        assert applied == []

        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT to_regclass('kgw_test_users') AS t1, "
                "to_regclass('kgw_test_orders') AS t2"
            )
            row = await cur.fetchone()
            assert row["t1"] == "kgw_test_users"
            assert row["t2"] == "kgw_test_orders"
    finally:
        async with pool.connection() as conn:
            await conn.execute("DROP TABLE IF EXISTS kgw_test_users")
            await conn.execute("DROP TABLE IF EXISTS kgw_test_orders")
            await conn.execute("DROP TABLE IF EXISTS kgw_migration")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_migration_runner_skips_non_sql_files(pg_dsn: str, tmp_path: Path):
    from kgw.db import build_pool, run_migrations

    sql_dir = tmp_path / "sql"
    sql_dir.mkdir()
    (sql_dir / "001_init.sql").write_text(
        "CREATE TABLE kgw_test_init (id INT PRIMARY KEY);"
    )
    (sql_dir / "README.md").write_text("# notes")
    (sql_dir / "002_init.sql.bak").write_text("nonsense")

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        applied = await run_migrations(pool, sql_dir)
        assert applied == ["001_init.sql"]
    finally:
        async with pool.connection() as conn:
            await conn.execute("DROP TABLE IF EXISTS kgw_test_init")
            await conn.execute("DROP TABLE IF EXISTS kgw_migration")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_pool_acquire_returns_dict_rows(pg_dsn: str):
    from kgw.db import build_pool

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        async with pool.connection() as conn:
            cur = await conn.execute("SELECT 1 AS one, 'x' AS letter")
            row = await cur.fetchone()
            assert row == {"one": 1, "letter": "x"}
    finally:
        await pool.close()
