"""Tests for kgw.metadata.binding — state track 3 (binding CRUD + outbox).

Integration tests use a real OpenGauss instance configured via the repo
.env file.  Unit tests (test_new_attempt_id_monotonic) run in-process only.
"""

# pylint: disable=redefined-outer-name  # pytest fixture pattern

from __future__ import annotations

from pathlib import Path

import pytest
from kgw.db import build_pool, run_migrations
from kgw.metadata.binding import (
    count_in_use,
    delete_by_attempt,
    delete_by_directory,
    delete_by_file,
    mark_synced_by_attempt,
    new_attempt_id,
    rename_directory_prefix,
    sample_in_use,
    upsert_pending,
    write_outbox,
)
from kgw.metadata.registry import create_property

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


@pytest.fixture
async def binding_pool(pg_dsn: str):
    """Set up a pool with all migrations applied; tear down all kgw tables after."""
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)
        yield pool
    finally:
        async with pool.connection() as conn:
            for table in _TABLES_TO_DROP:
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()


# ---------------------------------------------------------------------------
# Pure unit test — no DB needed
# ---------------------------------------------------------------------------


def test_new_attempt_id_monotonic():
    import time

    a = new_attempt_id()
    time.sleep(1e-6)
    b = new_attempt_id()
    assert b > a


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_upsert_pending_then_synced(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind1", value_type="string"
    )
    aid = new_attempt_id()

    async with binding_pool.connection() as conn:
        await upsert_pending(
            conn,
            property_id=prop.property_id,
            kn_code="hr",
            file_path="/docs/a.md",
            attempt_id=aid,
        )
        await conn.commit()

    n = await mark_synced_by_attempt(binding_pool, attempt_id=aid)
    assert n == 1

    # Synced row is still in use
    c = await count_in_use(binding_pool, prop.property_id)
    assert c == 1


@pytest.mark.integration
async def test_delete_by_attempt_rolls_back_pending(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind2", value_type="string"
    )
    aid = new_attempt_id()

    async with binding_pool.connection() as conn:
        await upsert_pending(
            conn,
            property_id=prop.property_id,
            kn_code="hr",
            file_path="/docs/b.md",
            attempt_id=aid,
        )
        await conn.commit()

    n = await delete_by_attempt(binding_pool, aid)
    assert n == 1

    c = await count_in_use(binding_pool, prop.property_id)
    assert c == 0


@pytest.mark.integration
async def test_delete_by_file_removes_all_bindings(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind3", value_type="string"
    )
    aid1 = new_attempt_id()
    aid2 = new_attempt_id()

    async with binding_pool.connection() as conn:
        await upsert_pending(
            conn,
            property_id=prop.property_id,
            kn_code="hr",
            file_path="/docs/c.md",
            attempt_id=aid1,
        )
        await conn.commit()

    # Mark synced, then upsert PENDING again with a new attempt
    await mark_synced_by_attempt(binding_pool, attempt_id=aid1)

    async with binding_pool.connection() as conn:
        await upsert_pending(
            conn,
            property_id=prop.property_id,
            kn_code="hr",
            file_path="/docs/c.md",
            attempt_id=aid2,
        )
        await conn.commit()

    n = await delete_by_file(binding_pool, kn_code="hr", file_path="/docs/c.md")
    assert n == 1  # only one row (the upsert replaces in-place)

    c = await count_in_use(binding_pool, prop.property_id)
    assert c == 0


@pytest.mark.integration
async def test_delete_by_directory_prefix_match(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind4", value_type="string"
    )
    base_aid = new_attempt_id()

    async with binding_pool.connection() as conn:
        for path in ("/dir/a.md", "/dir/sub/b.md", "/other/c.md"):
            await upsert_pending(
                conn,
                property_id=prop.property_id,
                kn_code="hr",
                file_path=path,
                attempt_id=new_attempt_id(),
            )
        # Sibling row: different kn_code, same directory path
        await upsert_pending(
            conn,
            property_id=prop.property_id,
            kn_code="legal",
            file_path="/dir/x.md",
            attempt_id=base_aid,
        )
        await conn.commit()

    n = await delete_by_directory(binding_pool, kn_code="hr", directory_path="/dir")
    assert n == 2

    # /other/c.md for hr survives
    c_hr = await count_in_use(binding_pool, prop.property_id)
    # legal row also survives
    rows = await sample_in_use(binding_pool, prop.property_id, limit=10)
    paths = {(r["knCode"], r["filePath"]) for r in rows}
    assert ("hr", "/other/c.md") in paths
    assert ("legal", "/dir/x.md") in paths
    assert ("hr", "/dir/a.md") not in paths
    assert ("hr", "/dir/sub/b.md") not in paths
    assert c_hr >= 1  # at least the /other/c.md row


@pytest.mark.integration
async def test_delete_by_directory_escapes_like_metachars(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind4b", value_type="string"
    )

    async with binding_pool.connection() as conn:
        for path in ("/dir_2025/a.md", "/dirX2025/a.md", "/dir_2025/sub/b.md"):
            await upsert_pending(
                conn,
                property_id=prop.property_id,
                kn_code="hr",
                file_path=path,
                attempt_id=new_attempt_id(),
            )
        await conn.commit()

    n = await delete_by_directory(
        binding_pool, kn_code="hr", directory_path="/dir_2025"
    )
    assert n == 2

    # /dirX2025/a.md must survive — the underscore is literal, not a wildcard
    async with binding_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                "WHERE kn_code='hr' AND file_path='/dirX2025/a.md'",
            )
            row = await cur.fetchone()
    assert row["c"] == 1


@pytest.mark.integration
async def test_upsert_pending_idempotent_replaces_attempt_id(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind5", value_type="string"
    )
    aid1 = new_attempt_id()
    aid2 = new_attempt_id()
    assert aid2 > aid1

    async with binding_pool.connection() as conn:
        await upsert_pending(
            conn,
            property_id=prop.property_id,
            kn_code="hr",
            file_path="/docs/d.md",
            attempt_id=aid1,
        )
        await conn.commit()

    async with binding_pool.connection() as conn:
        await upsert_pending(
            conn,
            property_id=prop.property_id,
            kn_code="hr",
            file_path="/docs/d.md",
            attempt_id=aid2,
        )
        await conn.commit()

    # Only the second attempt_id should exist — deleting by it removes exactly 1 row
    n = await delete_by_attempt(binding_pool, aid2)
    assert n == 1

    # First attempt_id row is gone (overwritten)
    n_old = await delete_by_attempt(binding_pool, aid1)
    assert n_old == 0


@pytest.mark.integration
async def test_count_and_sample_in_use_excludes_other_property(binding_pool):
    prop_a = await create_property(
        binding_pool, property_name="t_bind6a", value_type="string"
    )
    prop_b = await create_property(
        binding_pool, property_name="t_bind6b", value_type="string"
    )

    async with binding_pool.connection() as conn:
        await upsert_pending(
            conn,
            property_id=prop_a.property_id,
            kn_code="hr",
            file_path="/docs/e.md",
            attempt_id=new_attempt_id(),
        )
        await upsert_pending(
            conn,
            property_id=prop_b.property_id,
            kn_code="hr",
            file_path="/docs/f.md",
            attempt_id=new_attempt_id(),
        )
        await conn.commit()

    c_a = await count_in_use(binding_pool, prop_a.property_id)
    c_b = await count_in_use(binding_pool, prop_b.property_id)
    assert c_a == 1
    assert c_b == 1

    rows_a = await sample_in_use(binding_pool, prop_a.property_id)
    assert len(rows_a) == 1
    assert rows_a[0]["filePath"] == "/docs/e.md"

    rows_b = await sample_in_use(binding_pool, prop_b.property_id)
    assert len(rows_b) == 1
    assert rows_b[0]["filePath"] == "/docs/f.md"


@pytest.mark.integration
async def test_write_outbox_inserts_row(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind7", value_type="string"
    )
    aid = new_attempt_id()

    await write_outbox(
        binding_pool,
        property_id=prop.property_id,
        kn_code="hr",
        file_path="/docs/g.md",
        attempt_id=aid,
        reason="ROLLBACK_FAILED",
    )

    async with binding_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id, kn_code, file_path, attempt_id, reason "
                "FROM kgw_metadata_binding_outbox WHERE attempt_id=%s",
                (aid,),
            )
            row = await cur.fetchone()

    assert row is not None
    assert row["property_id"] == prop.property_id
    assert row["kn_code"] == "hr"
    assert row["file_path"] == "/docs/g.md"
    assert row["attempt_id"] == aid
    assert row["reason"] == "ROLLBACK_FAILED"


@pytest.mark.integration
async def test_rename_directory_prefix_rewrites_only_matching_paths(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind_rn1", value_type="string"
    )
    paths = [
        ("hr", "/docs/old/a.md"),
        ("hr", "/docs/old/sub/b.md"),
        ("hr", "/docs/older/c.md"),  # sibling — must NOT match
        ("hr", "/elsewhere/d.md"),  # outside — must NOT match
        ("legal", "/docs/old/x.md"),  # different kn_code — must NOT match
    ]
    async with binding_pool.connection() as conn:
        for kn_code, fp in paths:
            await upsert_pending(
                conn,
                property_id=prop.property_id,
                kn_code=kn_code,
                file_path=fp,
                attempt_id=new_attempt_id(),
            )
        await conn.commit()

    n = await rename_directory_prefix(
        binding_pool,
        kn_code="hr",
        old_directory_path="/docs/old",
        new_directory_path="/docs/new",
    )
    assert n == 2

    async with binding_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT kn_code, file_path FROM kgw_metadata_property_binding "
                "ORDER BY kn_code, file_path"
            )
            rows = [(r["kn_code"], r["file_path"]) for r in await cur.fetchall()]

    assert rows == [
        ("hr", "/docs/new/a.md"),
        ("hr", "/docs/new/sub/b.md"),
        ("hr", "/docs/older/c.md"),
        ("hr", "/elsewhere/d.md"),
        ("legal", "/docs/old/x.md"),
    ]


@pytest.mark.integration
async def test_rename_directory_prefix_escapes_like_metachars(binding_pool):
    prop = await create_property(
        binding_pool, property_name="t_bind_rn2", value_type="string"
    )
    async with binding_pool.connection() as conn:
        for fp in ("/dir_2025/a.md", "/dir_2025/sub/b.md", "/dirX2025/a.md"):
            await upsert_pending(
                conn,
                property_id=prop.property_id,
                kn_code="hr",
                file_path=fp,
                attempt_id=new_attempt_id(),
            )
        await conn.commit()

    n = await rename_directory_prefix(
        binding_pool,
        kn_code="hr",
        old_directory_path="/dir_2025",
        new_directory_path="/dir_2026",
    )
    assert n == 2

    async with binding_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT file_path FROM kgw_metadata_property_binding "
                "WHERE kn_code='hr' ORDER BY file_path"
            )
            rows = [r["file_path"] for r in await cur.fetchall()]
    assert rows == ["/dir_2026/a.md", "/dir_2026/sub/b.md", "/dirX2025/a.md"]
