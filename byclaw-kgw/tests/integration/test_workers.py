"""Integration tests: background workers GW1–GW6.

Tests cleanup worker (PURGING/PURGE_FAILED → purge backend columns)
and reconcile worker (stale DELETING cleanup).
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument,wrong-import-position

import asyncio
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import respx
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


class _ReconcileConfig:
    resource_code = _KN_DIRECT
    domain_url = _KB_DIRECT_URL
    domain_name = ""
    headers: dict[str, str] = {}

    def operation_path(self, op_id):  # pylint: disable=unused-argument
        return "/api/v1/knowledgeItems/metadata/get"


class _ReconcileConfigProvider:
    async def get_kb_config(self, kn_code: str):  # pylint: disable=unused-argument
        return _ReconcileConfig()


class _ReconcileAuthProvider:
    async def resolve_headers(self, headers, user_code=None):  # pylint: disable=unused-argument
        return {}


def _reconcile_state(app) -> SimpleNamespace:
    return SimpleNamespace(
        http=app.state.http,
        config_provider=_ReconcileConfigProvider(),
        auth_provider=_ReconcileAuthProvider(),
    )


async def _delete_by_property_ids(pool, property_ids: list[int]) -> None:
    """Clean up test data from all worker-related tables."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            ids = ",".join(str(pid) for pid in property_ids)
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
    """GW1: cleanup_iteration purges sync rows and physically deletes DELETED properties."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, value_type, status, backend_name) "
                "VALUES ('gw1_prop', 'string', 'ACTIVE', '__byclaw_kgw__gw1_prop__v99') "
                "RETURNING property_id"
            )
            pid = (await cur.fetchone())["property_id"]
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, endpoint_key, sync_status) "
                "VALUES (%s, %s, 'PURGING')",
                (pid, _KB_DIRECT_URL),
            )
        await conn.commit()

    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(f"{_KB_DIRECT_URL}/api/v1/metadataProperties/delete").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        processed = await cleanup_iteration(app.state, batch_size=10, backoff_minutes=0)
    assert processed == 1, processed
    assert route.called, "expected metadataProperties/delete to be called"

    # Phase 1: sync row was set to PURGED
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (pid, _KB_DIRECT_URL),
            )
            row = await cur.fetchone()
    assert row is not None and row["sync_status"] == "PURGED", (
        f"Expected sync_status PURGED, got {row}"
    )

    # Phase 2: mark property DELETED and trigger physical delete
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property SET status='DELETED' WHERE property_id=%s",
                (pid,),
            )
        await conn.commit()

    await cleanup_iteration(app.state, batch_size=10, backoff_minutes=0)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT backend_name, status FROM kgw_metadata_property WHERE property_id=%s",
                (pid,),
            )
            prop_row = await cur.fetchone()
    assert prop_row is None, (
        f"Expected property row to be physically deleted, got {prop_row}"
    )


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


# ---- GW3: reconcile worker cleans stale DELETING ----
async def test_reconcile_stale_deleting_absent(client, pool, app):
    """DELETING bindings older than threshold are deleted when backend field is absent."""
    await _delete_by_property_ids(pool, [101])
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
                "(property_id, kn_code, file_path, status, bound_at, updated_at) "
                "VALUES (101, %s, '/gw3/test.md', 'DELETING', NOW(), "
                "NOW() - INTERVAL '10 minutes')",
                (_KN_DIRECT,),
            )
        await conn.commit()

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/knowledgeItems/metadata/get").mock(
            return_value=httpx.Response(200, json=_ok_resp({"metadata": {}}))
        )
        deleted_n, restored_n, _ = await reconcile_iteration(
            pool,
            state=_reconcile_state(app),
            deleting_threshold_minutes=5,
            batch_size=50,
        )
    assert deleted_n == 1
    assert restored_n == 0

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


# ---- GW5: reconcile does NOT clean recent DELETING ----
async def test_reconcile_preserves_recent_deleting(client, pool, app):
    """Recent DELETING bindings (< threshold) are preserved."""
    await _delete_by_property_ids(pool, [102])
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
                "(property_id, kn_code, file_path, status, bound_at, updated_at) "
                "VALUES (102, %s, '/gw5/recent.md', 'DELETING', NOW(), NOW())",
                (_KN_DIRECT,),
            )
        await conn.commit()

    deleted_n, restored_n, _ = await reconcile_iteration(
        pool,
        state=_reconcile_state(app),
        deleting_threshold_minutes=5,
        batch_size=50,
    )
    assert deleted_n == 0
    assert restored_n == 0

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
    await _delete_by_property_ids(pool, [301, 302, 303])
    # Insert multiple stale DELETING bindings (updated 10 min ago)
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
                    "(property_id, kn_code, file_path, status, bound_at, updated_at) "
                    "VALUES (%s, %s, %s, 'DELETING', NOW(), "
                    "NOW() - INTERVAL '10 minutes')",
                    (pid, _KN_DIRECT, file_path),
                )
        await conn.commit()

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/knowledgeItems/metadata/get").mock(
            return_value=httpx.Response(200, json=_ok_resp({"metadata": {}}))
        )
        results = await asyncio.gather(
            reconcile_iteration(
                pool,
                state=_reconcile_state(app),
                deleting_threshold_minutes=5,
                batch_size=50,
            ),
            reconcile_iteration(
                pool,
                state=_reconcile_state(app),
                deleting_threshold_minutes=5,
                batch_size=50,
            ),
        )

    # Each returns (deleting_deleted, deleting_restored, stale_syncing_cleared)
    total_stale = sum(r[0] for r in results)
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
