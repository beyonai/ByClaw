"""Integration tests for the binding reconcile worker (Task 11 — simplified)."""

# pylint: disable=redefined-outer-name

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from kgw.db import build_pool, run_migrations
from kgw.metadata.binding import new_attempt_id
from kgw.metadata.registry import create_property
from kgw.workers.binding_reconcile import reconcile_iteration

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

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

_KN_CODE = "rc_kb"


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def rc_pool(pg_dsn: str):
    """Module-scoped pool shared across all reconcile worker tests."""
    pool = await build_pool(pg_dsn, min_size=1, max_size=3)
    await run_migrations(pool, SQL_DIR)
    yield pool
    # teardown
    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()
    await pool.close()


async def _clean_rows(pool) -> None:
    """Delete all binding + outbox + property rows between tests."""
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM kgw_metadata_binding_outbox")
        await conn.execute("DELETE FROM kgw_metadata_property_binding")
        await conn.execute("DELETE FROM kgw_metadata_property")
        await conn.commit()


# ---------------------------------------------------------------------------
# Test 1: outbox drain removes binding row
# ---------------------------------------------------------------------------
async def test_outbox_drained_removes_binding(rc_pool):
    await _clean_rows(rc_pool)

    p = await create_property(rc_pool, property_name="rc_t1", value_type="string")
    attempt_id = new_attempt_id()

    async with rc_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
            "VALUES (%s, %s, %s, 'PENDING', %s, NOW())",
            (p.property_id, _KN_CODE, "/docs/rc_t1.md", attempt_id),
        )
        await conn.execute(
            "INSERT INTO kgw_metadata_binding_outbox "
            "(property_id, kn_code, file_path, attempt_id, reason) "
            "VALUES (%s, %s, %s, %s, 'ROLLBACK_FAILED')",
            (p.property_id, _KN_CODE, "/docs/rc_t1.md", attempt_id),
        )
        await conn.commit()

    outbox_n, _ = await reconcile_iteration(rc_pool)

    async with rc_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM kgw_metadata_binding_outbox WHERE attempt_id=%s",
                (attempt_id,),
            )
            outbox_row = await cur.fetchone()
            await cur.execute(
                "SELECT 1 FROM kgw_metadata_property_binding WHERE attempt_id=%s",
                (attempt_id,),
            )
            binding_row = await cur.fetchone()

    assert outbox_row is None, "outbox row should be deleted"
    assert binding_row is None, "binding row should be deleted"
    assert outbox_n >= 1


# ---------------------------------------------------------------------------
# Test 2: outbox drain — binding already gone (no crash)
# ---------------------------------------------------------------------------
async def test_outbox_drained_no_crash_when_binding_missing(rc_pool):
    await _clean_rows(rc_pool)

    p = await create_property(rc_pool, property_name="rc_t2", value_type="string")
    attempt_id = new_attempt_id()

    async with rc_pool.connection() as conn:
        # Only the outbox row — no corresponding binding row
        await conn.execute(
            "INSERT INTO kgw_metadata_binding_outbox "
            "(property_id, kn_code, file_path, attempt_id, reason) "
            "VALUES (%s, %s, %s, %s, 'ROLLBACK_FAILED')",
            (p.property_id, _KN_CODE, "/docs/rc_t2.md", attempt_id),
        )
        await conn.commit()

    # Should not raise
    outbox_n, _ = await reconcile_iteration(rc_pool)

    async with rc_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM kgw_metadata_binding_outbox WHERE attempt_id=%s",
                (attempt_id,),
            )
            outbox_row = await cur.fetchone()

    assert outbox_row is None, (
        "outbox row should be deleted even when binding was missing"
    )
    assert outbox_n >= 1


# ---------------------------------------------------------------------------
# Test 3: stale PENDING → deleted
# ---------------------------------------------------------------------------
async def test_stale_pending_deleted(rc_pool):
    await _clean_rows(rc_pool)

    p = await create_property(rc_pool, property_name="rc_t3", value_type="string")
    attempt_id = new_attempt_id()

    async with rc_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
            "VALUES (%s, %s, %s, 'PENDING', %s, NOW() - INTERVAL '10 minutes')",
            (p.property_id, _KN_CODE, "/docs/rc_t3.md", attempt_id),
        )
        await conn.commit()

    _, stale_n = await reconcile_iteration(rc_pool, pending_threshold_minutes=5)

    async with rc_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM kgw_metadata_property_binding WHERE attempt_id=%s",
                (attempt_id,),
            )
            row = await cur.fetchone()

    assert row is None, "stale PENDING binding should be deleted"
    assert stale_n >= 1


# ---------------------------------------------------------------------------
# Test 4: fresh PENDING — not touched
# ---------------------------------------------------------------------------
async def test_fresh_pending_not_touched(rc_pool):
    await _clean_rows(rc_pool)

    p = await create_property(rc_pool, property_name="rc_t4", value_type="string")
    attempt_id = new_attempt_id()

    async with rc_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
            "VALUES (%s, %s, %s, 'PENDING', %s, NOW())",
            (p.property_id, _KN_CODE, "/docs/rc_t4.md", attempt_id),
        )
        await conn.commit()

    await reconcile_iteration(rc_pool, pending_threshold_minutes=5)

    async with rc_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT status FROM kgw_metadata_property_binding WHERE attempt_id=%s",
                (attempt_id,),
            )
            row = await cur.fetchone()

    assert row is not None, "fresh PENDING should not be deleted"
    assert row["status"] == "PENDING"


# ---------------------------------------------------------------------------
# Test 5: reconcile_iteration returns correct counts
# ---------------------------------------------------------------------------
async def test_reconcile_returns_counts(rc_pool):
    await _clean_rows(rc_pool)

    p = await create_property(rc_pool, property_name="rc_t5", value_type="string")
    attempt_id_ob = new_attempt_id()
    attempt_id_st = new_attempt_id()

    async with rc_pool.connection() as conn:
        # 1 outbox row (no matching binding)
        await conn.execute(
            "INSERT INTO kgw_metadata_binding_outbox "
            "(property_id, kn_code, file_path, attempt_id, reason) "
            "VALUES (%s, %s, %s, %s, 'ROLLBACK_FAILED')",
            (p.property_id, _KN_CODE, "/docs/rc_t5a.md", attempt_id_ob),
        )
        # 1 stale PENDING binding
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
            "VALUES (%s, %s, %s, 'PENDING', %s, NOW() - INTERVAL '10 minutes')",
            (p.property_id, _KN_CODE, "/docs/rc_t5b.md", attempt_id_st),
        )
        await conn.commit()

    outbox_n, stale_n = await reconcile_iteration(rc_pool, pending_threshold_minutes=5)

    assert outbox_n >= 1
    assert stale_n >= 1


# ---------------------------------------------------------------------------
# Test 6: multiple outbox rows — all drained
# ---------------------------------------------------------------------------
async def test_multiple_outbox_rows_all_drained(rc_pool):
    await _clean_rows(rc_pool)

    p = await create_property(rc_pool, property_name="rc_t6", value_type="string")
    attempt_ids = [new_attempt_id() for _ in range(3)]

    async with rc_pool.connection() as conn:
        for i, aid in enumerate(attempt_ids):
            fp = f"/docs/rc_t6_{i}.md"
            await conn.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
                "VALUES (%s, %s, %s, 'PENDING', %s, NOW())",
                (p.property_id, _KN_CODE, fp, aid),
            )
            await conn.execute(
                "INSERT INTO kgw_metadata_binding_outbox "
                "(property_id, kn_code, file_path, attempt_id, reason) "
                "VALUES (%s, %s, %s, %s, 'ROLLBACK_FAILED')",
                (p.property_id, _KN_CODE, fp, aid),
            )
        await conn.commit()

    outbox_n, _ = await reconcile_iteration(rc_pool)

    assert outbox_n == 3

    async with rc_pool.connection() as conn:
        async with conn.cursor() as cur:
            for aid in attempt_ids:
                await cur.execute(
                    "SELECT 1 FROM kgw_metadata_binding_outbox WHERE attempt_id=%s",
                    (aid,),
                )
                assert await cur.fetchone() is None, f"outbox row {aid} should be gone"
                await cur.execute(
                    "SELECT 1 FROM kgw_metadata_property_binding WHERE attempt_id=%s",
                    (aid,),
                )
                assert await cur.fetchone() is None, f"binding row {aid} should be gone"
