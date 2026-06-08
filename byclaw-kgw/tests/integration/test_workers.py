"""Integration tests: background workers GW1–GW6.

Tests cleanup worker (PURGING/PURGE_FAILED → purge backend columns)
and reconcile worker (stale PENDING cleanup, outbox processing).
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument,wrong-import-position

import asyncio
from typing import Any

import httpx
import pytest
import respx
from kgw.metadata import binding as binding_mod
from kgw.workers.binding_reconcile import reconcile_iteration
from kgw.workers.cleanup import cleanup_iteration

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# KB config constants — must match values in conftest.py
_KN_DIRECT = "200001"
_KB_DIRECT_URL = "http://kb-direct.test"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ok_resp(obj: dict | None = None) -> dict[str, Any]:
    return {"resultCode": "0", "resultMsg": "success", "resultObject": obj or {}}


def _fail_resp(msg: str = "error") -> dict[str, Any]:
    return {"resultCode": "-1", "resultMsg": msg, "resultObject": {}}


async def _delete_by_property_ids(pool, property_ids: list[int]) -> None:
    """Clean up test data from all worker-related tables."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            ids = ",".join(str(pid) for pid in property_ids)
            await cur.execute(
                f"DELETE FROM kgw_metadata_binding_outbox WHERE property_id IN ({ids})"
            )
            await cur.execute(
                f"DELETE FROM kgw_metadata_property_binding WHERE property_id IN ({ids})"
            )
            await cur.execute(
                f"DELETE FROM kgw_metadata_property_sync WHERE property_id IN ({ids})"
            )
            await cur.execute(
                f"DELETE FROM kgw_metadata_property WHERE property_id IN ({ids})"
            )
        await conn.commit()


# ---- GW1: cleanup worker processes PURGING rows ----
async def test_cleanup_purging_to_purged(client, pool, app):
    """cleanup_iteration deletes backend columns and marks PURGED."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, value_type, status, backend_name, property_id) "
                "VALUES ('gw1_prop', 'string', 'ACTIVE', '__byclaw_kgw__gw1_prop__v99', 99)"
            )
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, endpoint_key, sync_status) "
                "VALUES (99, %s, 'PURGING')",
                (_KB_DIRECT_URL,),
            )
        await conn.commit()

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/metadataProperties/delete").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        await cleanup_iteration(app.state, batch_size=10, backoff_minutes=0)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=99 AND endpoint_key=%s",
                (_KB_DIRECT_URL,),
            )
            row = await cur.fetchone()
    assert row is not None and row["sync_status"] == "PURGED", (
        f"Expected PURGED, got {row}"
    )
    # GW1: Verify property row still exists after purge (backend_name NOT NULL retained)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT backend_name, status FROM kgw_metadata_property WHERE property_id=99"
            )
            prop_row = await cur.fetchone()
    assert prop_row is not None, "Property row should still exist after purge"
    assert prop_row["status"] == "ACTIVE", f"Expected ACTIVE status, got {prop_row}"
    await _delete_by_property_ids(pool, [99])


# ---- GW2: cleanup worker handles PURGE_FAILED ----
async def test_cleanup_purge_failed(client, pool, app):
    """When backend delete fails, row is marked PURGE_FAILED."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, value_type, status, backend_name, property_id) "
                "VALUES ('gw2_prop', 'string', 'ACTIVE', '__byclaw_kgw__gw2_prop__v100', 100)"
            )
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, endpoint_key, sync_status) "
                "VALUES (100, %s, 'PURGING')",
                (_KB_DIRECT_URL,),
            )
        await conn.commit()

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/metadataProperties/delete").mock(
            return_value=httpx.Response(200, json=_fail_resp("delete failed"))
        )
        await cleanup_iteration(app.state, batch_size=10, backoff_minutes=0)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=100 AND endpoint_key=%s",
                (_KB_DIRECT_URL,),
            )
            row = await cur.fetchone()
    assert row is not None and row["sync_status"] == "PURGE_FAILED", (
        f"Expected PURGE_FAILED, got {row}"
    )
    # GW2: Verify property row survives failed purge
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_name FROM kgw_metadata_property WHERE property_id=100"
            )
            prop_row = await cur.fetchone()
    assert prop_row is not None, "Property row should survive failed purge"
    await _delete_by_property_ids(pool, [100])


# ---- GW3: reconcile worker cleans stale PENDING ----
async def test_reconcile_stale_pending(client, pool, app):
    """PENDING bindings older than threshold are deleted."""
    attempt_id = binding_mod.new_attempt_id()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, value_type, status, backend_name, property_id) "
                "VALUES ('gw3_prop', 'string', 'ACTIVE', '__byclaw_kgw__gw3_prop__v101', 101)"
            )
            await conn.commit()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
                "VALUES (101, %s, '/gw3/test.md', 'PENDING', %s, "
                "NOW() - INTERVAL '10 minutes')",
                (_KN_DIRECT, attempt_id),
            )
        await conn.commit()

    await reconcile_iteration(pool, pending_threshold_minutes=5, batch_size=50)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_metadata_property_binding "
                "WHERE property_id=101 AND kn_code=%s",
                (_KN_DIRECT,),
            )
            row = await cur.fetchone()
    assert row is not None and row["c"] == 0, f"Expected 0 bindings, got {row}"
    await _delete_by_property_ids(pool, [101])


# ---- GW5: reconcile does NOT clean recent PENDING ----
async def test_reconcile_preserves_recent_pending(client, pool, app):
    """Recent PENDING bindings (< threshold) are preserved."""
    attempt_id = binding_mod.new_attempt_id()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, value_type, status, backend_name, property_id) "
                "VALUES ('gw5_prop', 'string', 'ACTIVE', '__byclaw_kgw__gw5_prop__v102', 102)"
            )
            await conn.commit()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id) "
                "VALUES (102, %s, '/gw5/recent.md', 'PENDING', %s)",
                (_KN_DIRECT, attempt_id),
            )
        await conn.commit()

    await reconcile_iteration(pool, pending_threshold_minutes=5, batch_size=50)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_metadata_property_binding "
                "WHERE property_id=102 AND kn_code=%s",
                (_KN_DIRECT,),
            )
            row = await cur.fetchone()
    assert row is not None and row["c"] == 1, (
        f"Expected 1 binding (preserved), got {row}"
    )
    await _delete_by_property_ids(pool, [102])


# ---- GW4: reconcile processes outbox entries ----
async def test_reconcile_processes_outbox(client, pool, app):
    """Outbox entries with matching bindings are drained."""
    attempt_id = binding_mod.new_attempt_id()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, value_type, status, backend_name, property_id) "
                "VALUES ('gw4_prop', 'string', 'ACTIVE', '__byclaw_kgw__gw4_prop__v103', 103)"
            )
            await conn.commit()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id) "
                "VALUES (103, %s, '/gw4/outbox-test.md', 'PENDING', %s)",
                (_KN_DIRECT, attempt_id),
            )
            await conn.commit()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_binding_outbox "
                "(property_id, kn_code, file_path, attempt_id, reason, created_at) "
                "VALUES (103, %s, '/gw4/outbox-test.md', %s, 'ROLLBACK_FAILED', NOW())",
                (_KN_DIRECT, attempt_id),
            )
        await conn.commit()

    await reconcile_iteration(pool, pending_threshold_minutes=5, batch_size=50)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_metadata_property_binding "
                "WHERE property_id=103"
            )
            binding_row = await cur.fetchone()
            binding_count = binding_row["c"] if binding_row else 0
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_metadata_binding_outbox "
                "WHERE property_id=103"
            )
            outbox_row = await cur.fetchone()
            outbox_count = outbox_row["c"] if outbox_row else 0
    assert binding_count == 0, f"Expected 0 bindings, got {binding_count}"
    assert outbox_count == 0, f"Expected 0 outbox entries, got {outbox_count}"
    await _delete_by_property_ids(pool, [103])


# ---- GW6: Multi-pod concurrent safety (SKIP LOCKED) ----
async def test_cleanup_concurrent_skip_locked(client, pool, app):
    """GW6: Two concurrent cleanup iterations don't process the same rows (SKIP LOCKED)."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            for pid, prop_name in [
                (201, "gw6a_prop"),
                (202, "gw6b_prop"),
                (203, "gw6c_prop"),
            ]:
                await cur.execute(
                    "INSERT INTO kgw_metadata_property "
                    "(property_name, value_type, status, backend_name, property_id) "
                    "VALUES (%s, 'string', 'ACTIVE', %s, %s)",
                    (prop_name, f"__byclaw_kgw__{prop_name}__v{pid}", pid),
                )
                await cur.execute(
                    "INSERT INTO kgw_metadata_property_sync "
                    "(property_id, endpoint_key, sync_status) "
                    "VALUES (%s, %s, 'PURGING')",
                    (pid, _KB_DIRECT_URL),
                )
        await conn.commit()

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/metadataProperties/delete").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        results = await asyncio.gather(
            cleanup_iteration(app.state, batch_size=2, backoff_minutes=0),
            cleanup_iteration(app.state, batch_size=2, backoff_minutes=0),
        )

    total = sum(results)
    assert total == 3, (
        f"Expected 3 total rows processed across both iterations, got {total}"
    )

    # All three should be PURGED, each exactly once
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_metadata_property_sync "
                "WHERE property_id IN (201,202,203) AND sync_status='PURGED'"
            )
            row = await cur.fetchone()
    assert row is not None and row["c"] == 3, f"Expected 3 PURGED rows, got {row}"
    await _delete_by_property_ids(pool, [201, 202, 203])


async def test_reconcile_concurrent_skip_locked(client, pool, app):
    """GW6: Two concurrent reconcile iterations don't process the same bindings (SKIP LOCKED)."""
    # Insert multiple stale PENDING bindings (bound 10 min ago)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            for pid, file_path in [
                (301, "/gw6/d1.md"),
                (302, "/gw6/d2.md"),
                (303, "/gw6/d3.md"),
            ]:
                await cur.execute(
                    "INSERT INTO kgw_metadata_property "
                    "(property_name, value_type, status, backend_name, property_id) "
                    "VALUES (%s, 'string', 'ACTIVE', %s, %s)",
                    (
                        f"gw6e_{pid}_prop",
                        f"__byclaw_kgw__gw6e_{pid}__v{pid}",
                        pid,
                    ),
                )
        await conn.commit()
        async with conn.cursor() as cur:
            for pid, file_path in [
                (301, "/gw6/d1.md"),
                (302, "/gw6/d2.md"),
                (303, "/gw6/d3.md"),
            ]:
                await cur.execute(
                    "INSERT INTO kgw_metadata_property_binding "
                    "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
                    "VALUES (%s, %s, %s, 'PENDING', %s, NOW() - INTERVAL '10 minutes')",
                    (pid, _KN_DIRECT, file_path, binding_mod.new_attempt_id()),
                )
        await conn.commit()

    results = await asyncio.gather(
        reconcile_iteration(pool, pending_threshold_minutes=5, batch_size=50),
        reconcile_iteration(pool, pending_threshold_minutes=5, batch_size=50),
    )

    # Each returns (outbox_drained, stale_pending_deleted, stale_syncing_cleared)
    total_stale = sum(r[1] for r in results)
    assert total_stale == 3, (
        f"Expected 3 stale bindings deleted total, got {total_stale}"
    )

    # No bindings should remain
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_metadata_property_binding "
                "WHERE property_id IN (301,302,303)"
            )
            row = await cur.fetchone()
    assert row is not None and row["c"] == 0, (
        f"Expected 0 remaining bindings, got {row}"
    )
    await _delete_by_property_ids(pool, [301, 302, 303])
