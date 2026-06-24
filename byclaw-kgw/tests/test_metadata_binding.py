"""Tests for kgw.metadata.binding usage projection semantics."""

# pylint: disable=redefined-outer-name  # pytest fixture pattern

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from kgw.db import build_pool, run_migrations
from kgw.metadata.binding import (
    bind_usage,
    bind_usage_with_previous_status,
    confirm_deleting_absent,
    count_in_use,
    delete_by_directory,
    delete_by_file,
    mark_deleting_by_file,
    mark_deleting_by_property_op,
    rename_directory_prefix,
    restore_bound,
    restore_bound_if_unchanged,
    sample_in_use,
)
from kgw.metadata.registry import create_property

REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"

_TABLES_TO_DROP = (
    "kgw_metadata_property_sync",
    "kgw_metadata_property_binding",
    "kgw_metadata_property",
    "kgw_audit_log",
    "kgw_kb_source_lock",
    "kgw_kb_conflict_log",
    "kgw_migration",
)


@pytest.fixture
async def binding_pool(pg_dsn: str, db_schema: str):
    """Set up a pool with all migrations applied; tear down all kgw tables after."""
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR, schema=db_schema)
        yield pool
    finally:
        async with pool.connection() as conn:
            for table in _TABLES_TO_DROP:
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_bind_usage_inserts_bound_row(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound1", value_type="string"
    )
    async with binding_pool.connection() as conn:
        created = await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/a.md"
        )
        await conn.commit()
    assert created is True
    assert await count_in_use(binding_pool, prop.property_id) == 1
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows == [{"knCode": "hr", "filePath": "/docs/a.md", "status": "BOUND"}]


@pytest.mark.integration
async def test_bind_usage_restores_deleting_to_bound(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound2", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/b.md"
        )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/b.md"
        )
        created = await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/b.md"
        )
        await conn.commit()
    assert created is False
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows[0]["status"] == "BOUND"


@pytest.mark.integration
async def test_bind_usage_with_previous_status_is_safe_for_concurrent_first_bind(
    binding_pool,
):
    prop = await create_property(
        binding_pool, property_name="t_bound2_race", value_type="string"
    )

    async def bind_once():
        async with binding_pool.connection() as conn:
            result = await bind_usage_with_previous_status(
                conn,
                property_id=prop.property_id,
                kn_code="hr",
                file_path="/docs/race.md",
            )
            await conn.commit()
            return result

    results = await asyncio.gather(*(bind_once() for _ in range(5)))

    assert sum(1 for r in results if r.created) == 1
    assert sum(1 for r in results if not r.created) == 4
    assert {r.previous_status for r in results if not r.created} == {"BOUND"}
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows == [{"knCode": "hr", "filePath": "/docs/race.md", "status": "BOUND"}]


@pytest.mark.integration
async def test_bind_usage_with_previous_status_reports_deleting(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound2_prev", value_type="string"
    )
    async with binding_pool.connection() as conn:
        inserted = await bind_usage_with_previous_status(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/prev.md"
        )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/prev.md"
        )
        restored = await bind_usage_with_previous_status(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/prev.md"
        )
        await conn.commit()

    assert inserted.created is True
    assert inserted.previous_status is None
    assert restored.created is False
    assert restored.previous_status == "DELETING"
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows[0]["status"] == "BOUND"


@pytest.mark.integration
async def test_bind_usage_unique_violation_savepoint_preserves_outer_transaction(
    binding_pool,
):
    prop = await create_property(
        binding_pool, property_name="t_bound2_outer_tx", value_type="string"
    )

    async with binding_pool.connection() as conn:
        async with conn.transaction():
            inserted = await bind_usage_with_previous_status(
                conn,
                property_id=prop.property_id,
                kn_code="hr",
                file_path="/docs/outer-tx.md",
            )
            repeated = await bind_usage_with_previous_status(
                conn,
                property_id=prop.property_id,
                kn_code="hr",
                file_path="/docs/outer-tx.md",
            )
            async with conn.cursor() as cur:
                await cur.execute("SELECT 1 AS still_usable")
                assert (await cur.fetchone())["still_usable"] == 1
            followup = await bind_usage_with_previous_status(
                conn,
                property_id=prop.property_id,
                kn_code="hr",
                file_path="/docs/outer-tx-followup.md",
            )

    assert inserted.created is True
    assert repeated.created is False
    assert repeated.previous_status == "BOUND"
    assert followup.created is True
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert {(r["filePath"], r["status"]) for r in rows} == {
        ("/docs/outer-tx.md", "BOUND"),
        ("/docs/outer-tx-followup.md", "BOUND"),
    }


@pytest.mark.integration
async def test_deleting_still_counts_as_in_use(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound3", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/c.md"
        )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/c.md"
        )
        await conn.commit()
    assert await count_in_use(binding_pool, prop.property_id) == 1
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows[0]["status"] == "DELETING"


@pytest.mark.integration
async def test_confirm_deleting_absent_deletes_only_deleting_rows(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound4", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/d.md"
        )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/d.md"
        )
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/e.md"
        )
        await conn.commit()
    deleted = await confirm_deleting_absent(
        binding_pool, property_id=prop.property_id, kn_code="hr", file_path="/docs/d.md"
    )
    assert deleted == 1
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert {(r["filePath"], r["status"]) for r in rows} == {("/docs/e.md", "BOUND")}


@pytest.mark.integration
async def test_confirm_deleting_absent_keeps_bound_rows(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound5", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/f.md"
        )
        await conn.commit()

    deleted = await confirm_deleting_absent(
        binding_pool, property_id=prop.property_id, kn_code="hr", file_path="/docs/f.md"
    )

    assert deleted == 0
    assert await sample_in_use(binding_pool, prop.property_id, limit=10) == [
        {"knCode": "hr", "filePath": "/docs/f.md", "status": "BOUND"}
    ]


@pytest.mark.integration
async def test_delete_by_file_removes_confirmed_clean_rows(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound6", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/g.md"
        )
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="legal", file_path="/docs/g.md"
        )
        await conn.commit()

    deleted = await delete_by_file(binding_pool, kn_code="hr", file_path="/docs/g.md")

    assert deleted == 1
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows == [{"knCode": "legal", "filePath": "/docs/g.md", "status": "BOUND"}]


@pytest.mark.integration
async def test_delete_by_directory_removes_confirmed_clean_rows(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound7", value_type="string"
    )
    async with binding_pool.connection() as conn:
        for path in ("/dir/a.md", "/dir/sub/b.md", "/other/c.md"):
            await bind_usage(
                conn, property_id=prop.property_id, kn_code="hr", file_path=path
            )
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="legal", file_path="/dir/x.md"
        )
        await conn.commit()

    deleted = await delete_by_directory(
        binding_pool, kn_code="hr", directory_path="/dir"
    )

    assert deleted == 2
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert {(r["knCode"], r["filePath"], r["status"]) for r in rows} == {
        ("hr", "/other/c.md", "BOUND"),
        ("legal", "/dir/x.md", "BOUND"),
    }


@pytest.mark.integration
async def test_delete_by_directory_escapes_like_metachars(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound8", value_type="string"
    )
    async with binding_pool.connection() as conn:
        for path in ("/dir_2025/a.md", "/dirX2025/a.md", "/dir_2025/sub/b.md"):
            await bind_usage(
                conn, property_id=prop.property_id, kn_code="hr", file_path=path
            )
        await conn.commit()

    deleted = await delete_by_directory(
        binding_pool, kn_code="hr", directory_path="/dir_2025"
    )

    assert deleted == 2
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows == [{"knCode": "hr", "filePath": "/dirX2025/a.md", "status": "BOUND"}]


@pytest.mark.integration
async def test_rename_directory_prefix_preserves_statuses(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound9", value_type="string"
    )
    paths = [
        ("hr", "/docs/old/a.md"),
        ("hr", "/docs/old/sub/b.md"),
        ("hr", "/docs/older/c.md"),
        ("hr", "/elsewhere/d.md"),
        ("legal", "/docs/old/x.md"),
    ]
    async with binding_pool.connection() as conn:
        for kn_code, file_path in paths:
            await bind_usage(
                conn,
                property_id=prop.property_id,
                kn_code=kn_code,
                file_path=file_path,
            )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/old/a.md"
        )
        await conn.commit()

    renamed = await rename_directory_prefix(
        binding_pool,
        kn_code="hr",
        old_directory_path="/docs/old",
        new_directory_path="/docs/new",
    )

    assert renamed == 2
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert {(r["knCode"], r["filePath"], r["status"]) for r in rows} == {
        ("hr", "/docs/new/a.md", "DELETING"),
        ("hr", "/docs/new/sub/b.md", "BOUND"),
        ("hr", "/docs/older/c.md", "BOUND"),
        ("hr", "/elsewhere/d.md", "BOUND"),
        ("legal", "/docs/old/x.md", "BOUND"),
    }


@pytest.mark.integration
async def test_rename_directory_prefix_escapes_like_metachars(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound10", value_type="string"
    )
    async with binding_pool.connection() as conn:
        for file_path in ("/dir_2025/a.md", "/dir_2025/sub/b.md", "/dirX2025/a.md"):
            await bind_usage(
                conn, property_id=prop.property_id, kn_code="hr", file_path=file_path
            )
        await conn.commit()

    renamed = await rename_directory_prefix(
        binding_pool,
        kn_code="hr",
        old_directory_path="/dir_2025",
        new_directory_path="/dir_2026",
    )

    assert renamed == 2
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert {(r["filePath"], r["status"]) for r in rows} == {
        ("/dir_2026/a.md", "BOUND"),
        ("/dir_2026/sub/b.md", "BOUND"),
        ("/dirX2025/a.md", "BOUND"),
    }


@pytest.mark.integration
async def test_mark_deleting_by_file_marks_all_file_bindings(binding_pool):
    prop_a = await create_property(
        binding_pool, property_name="t_bound11a", value_type="string"
    )
    prop_b = await create_property(
        binding_pool, property_name="t_bound11b", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop_a.property_id, kn_code="hr", file_path="/docs/h.md"
        )
        await bind_usage(
            conn, property_id=prop_b.property_id, kn_code="hr", file_path="/docs/h.md"
        )
        await bind_usage(
            conn, property_id=prop_a.property_id, kn_code="hr", file_path="/docs/i.md"
        )
        await conn.commit()

    marked = await mark_deleting_by_file(
        binding_pool, kn_code="hr", file_path="/docs/h.md"
    )

    assert marked == 2
    rows_a = await sample_in_use(binding_pool, prop_a.property_id, limit=10)
    rows_b = await sample_in_use(binding_pool, prop_b.property_id, limit=10)
    assert {(r["filePath"], r["status"]) for r in rows_a} == {
        ("/docs/h.md", "DELETING"),
        ("/docs/i.md", "BOUND"),
    }
    assert rows_b == [{"knCode": "hr", "filePath": "/docs/h.md", "status": "DELETING"}]


@pytest.mark.integration
async def test_restore_bound_restores_deleting_row(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound12", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/j.md"
        )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/j.md"
        )
        await conn.commit()

    restored = await restore_bound(
        binding_pool, property_id=prop.property_id, kn_code="hr", file_path="/docs/j.md"
    )

    assert restored == 1
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows == [{"knCode": "hr", "filePath": "/docs/j.md", "status": "BOUND"}]


@pytest.mark.integration
async def test_restore_bound_if_unchanged_skips_marker_mismatch(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound12_marker", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/mk.md"
        )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/mk.md"
        )
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT updated_at FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
                (prop.property_id, "hr", "/docs/mk.md"),
            )
            marker = (await cur.fetchone())["updated_at"]
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/mk.md"
        )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/mk.md"
        )
        await conn.commit()

    restored = await restore_bound_if_unchanged(
        binding_pool,
        property_id=prop.property_id,
        kn_code="hr",
        file_path="/docs/mk.md",
        updated_at=marker,
    )

    assert restored == 0
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert rows == [{"knCode": "hr", "filePath": "/docs/mk.md", "status": "DELETING"}]


@pytest.mark.integration
async def test_count_and_sample_in_use_include_bound_and_deleting(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bound13", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/k.md"
        )
        await bind_usage(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/l.md"
        )
        await mark_deleting_by_property_op(
            conn, property_id=prop.property_id, kn_code="hr", file_path="/docs/l.md"
        )
        await conn.commit()

    assert await count_in_use(binding_pool, prop.property_id) == 2
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    assert {(r["filePath"], r["status"]) for r in rows} == {
        ("/docs/k.md", "BOUND"),
        ("/docs/l.md", "DELETING"),
    }
    assert all(set(row) == {"knCode", "filePath", "status"} for row in rows)


@pytest.mark.integration
async def test_count_and_sample_in_use_exclude_other_property(binding_pool):
    prop_a = await create_property(
        binding_pool, property_name="t_bound14a", value_type="string"
    )
    prop_b = await create_property(
        binding_pool, property_name="t_bound14b", value_type="string"
    )
    async with binding_pool.connection() as conn:
        await bind_usage(
            conn, property_id=prop_a.property_id, kn_code="hr", file_path="/docs/m.md"
        )
        await bind_usage(
            conn, property_id=prop_b.property_id, kn_code="hr", file_path="/docs/n.md"
        )
        await conn.commit()

    assert await count_in_use(binding_pool, prop_a.property_id) == 1
    assert await count_in_use(binding_pool, prop_b.property_id) == 1
    assert await sample_in_use(binding_pool, prop_a.property_id) == [
        {"knCode": "hr", "filePath": "/docs/m.md", "status": "BOUND"}
    ]
    assert await sample_in_use(binding_pool, prop_b.property_id) == [
        {"knCode": "hr", "filePath": "/docs/n.md", "status": "BOUND"}
    ]
