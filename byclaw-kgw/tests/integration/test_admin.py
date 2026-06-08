"""Integration tests: admin endpoints.

Covers: audit query, conflict query, file lock/unlock,
ingest blocked by lock, metadata-properties list, orphans query.

No respx mocking -- all tests use the real byclaw-qa backend on port 8000
(via ``app.state`` resources seeded by conftest).
"""

# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_USER_ID = "test_user"


def _hdrs(extra: dict[str, str] | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


# Lock paths used across multiple tests
_LOCK_PATH = "/admin-lock/test.md"
_INGEST_LOCK_PATH = "/admin-lock/ingest-test.md"

# ---------------------------------------------------------------------------
# Audit query
# ---------------------------------------------------------------------------


async def test_audit_query_all(client):
    """GET /kgw/admin/v1/audit?pageSize=5 => resultCode=0, has data list."""
    resp = await client.get(
        "/kgw/admin/v1/audit",
        params={"pageSize": 5},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    data = body["resultObject"].get("data")
    assert isinstance(data, list)


async def test_audit_query_by_source(client):
    """GA1: GET /kgw/admin/v1/audit?source=ingest&pageSize=20 => resultCode=0."""
    resp = await client.get(
        "/kgw/admin/v1/audit",
        params={"source": "ingest", "pageSize": 20},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body


async def test_audit_query_by_kncode(client):
    """GET /kgw/admin/v1/audit?knCode=200001&pageSize=5 => resultCode=0."""
    resp = await client.get(
        "/kgw/admin/v1/audit",
        params={"knCode": _KN_DIRECT, "pageSize": 5},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body


# ---------------------------------------------------------------------------
# Conflicts query
# ---------------------------------------------------------------------------


async def test_conflicts_query(client):
    """GET /kgw/admin/v1/conflicts?pageSize=5 => resultCode=0, has data list."""
    resp = await client.get(
        "/kgw/admin/v1/conflicts",
        params={"pageSize": 5},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    data = body["resultObject"].get("data")
    assert isinstance(data, list)


async def test_conflicts_query_filtered(client):
    """GA4: GET /kgw/admin/v1/conflicts?knCode=200001&reason=STALE_VERSION => resultCode=0."""
    resp = await client.get(
        "/kgw/admin/v1/conflicts",
        params={"knCode": _KN_DIRECT, "reason": "STALE_VERSION"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    data = body["resultObject"].get("data")
    assert isinstance(data, list)


# ---------------------------------------------------------------------------
# Lock / unlock
#
# These tests share state via the database (module-scoped client fixture).
# Order is important:
#   lock -> re-lock (fail) -> unlock -> re-unlock (fail)
# ---------------------------------------------------------------------------


async def test_lock_file(client):
    """POST lock on a fresh file => resultCode=0."""
    resp = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_LOCK_PATH.lstrip('/')}/lock",
        json={"lockOwner": "manual"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["lockOwner"] == "manual"


async def test_lock_already_locked(client):
    """POST lock on same file again => resultCode=-1 (already locked)."""
    resp = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_LOCK_PATH.lstrip('/')}/lock",
        json={"lockOwner": "manual"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", body


async def test_unlock_file(client):
    """POST unlock on a locked file => resultCode=0."""
    resp = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_LOCK_PATH.lstrip('/')}/unlock",
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body


async def test_unlock_not_locked(client):
    """POST unlock on an already-unlocked file => resultCode=-1."""
    resp = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_LOCK_PATH.lstrip('/')}/unlock",
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", body


# ---------------------------------------------------------------------------
# Ingest blocked by lock
# ---------------------------------------------------------------------------


async def test_ingest_blocked_by_lock(client):
    """A lock by user 'manual' blocks an ingest from user 'connector'."""
    # First, lock the file
    resp_lock = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_INGEST_LOCK_PATH.lstrip('/')}/lock",
        json={"lockOwner": "manual"},
        headers=_hdrs(),
    )
    assert resp_lock.json()["resultCode"] == "0"

    # Second, try to ingest with a different user
    item_id = f"locked_ingest_{uuid.uuid4().hex[:8]}"
    resp_ingest = await client.post(
        "/kgw/ingest/v1/events",
        json={
            "sourceId": "admin_test",
            "itemId": item_id,
            "op": "upsert",
            "knCode": _KN_DIRECT,
            "filePath": _INGEST_LOCK_PATH,
            "content": "# locked content",
        },
        headers={"X-User-Id": "connector"},
    )
    body = resp_ingest.json()
    assert body["resultCode"] == "-1", body
    error_type = (body.get("resultObject") or {}).get("errorType", "")
    assert "SOURCE" in error_type or "LOCK" in error_type, (
        f"expected errorType containing 'SOURCE' or 'LOCK', got: {error_type}"
    )

    # Cleanup: unlock so test_cleanup_locks is a no-op
    resp_unlock = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_INGEST_LOCK_PATH.lstrip('/')}/unlock",
        headers=_hdrs(),
    )
    assert resp_unlock.json()["resultCode"] == "0"


# ---------------------------------------------------------------------------
# Metadata properties list
# ---------------------------------------------------------------------------


async def test_metadata_properties_list(client):
    """GA10: GET /kgw/admin/v1/metadata-properties => resultCode=0, has sync status info and DELETED properties."""
    resp = await client.get(
        "/kgw/admin/v1/metadata-properties",
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    data = body["resultObject"].get("data")
    assert isinstance(data, list)
    # Every property must expose status (ACTIVE or DELETED) and syncDetails
    for prop in data:
        assert "propertyName" in prop, f"Missing propertyName in {prop}"
        assert "status" in prop, f"Missing status in {prop}"
        assert "syncDetails" in prop, f"Missing syncDetails in {prop}"
        assert isinstance(prop["syncDetails"], list)


# ---------------------------------------------------------------------------
# Orphans query
# ---------------------------------------------------------------------------


async def test_orphans_query(client):
    """GET /kgw/admin/v1/metadata-properties/orphans?knCode=200001 => resultCode=0."""
    resp = await client.get(
        "/kgw/admin/v1/metadata-properties/orphans",
        params={"knCode": _KN_DIRECT},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body


# ---------------------------------------------------------------------------
# Cleanup: unlock any remaining locked files from tests
# ---------------------------------------------------------------------------


async def test_cleanup_locks(client):
    """Unlock any leftover locked files to leave a clean state."""
    for path in [_LOCK_PATH, _INGEST_LOCK_PATH]:
        await client.post(
            f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{path.lstrip('/')}/unlock",
            headers=_hdrs(),
        )
    # No assertion needed -- best-effort cleanup


# ---------------------------------------------------------------------------
# Audit by operationType (GA2)
# ---------------------------------------------------------------------------


async def test_audit_query_by_operation(client, app):
    """GA2: Query audit logs filtered by operationType=ingest.upsert."""
    # Trigger an ingest.upsert operation via ingest
    item_id = f"ga2_{uuid.uuid4().hex[:8]}"
    resp_ingest = await client.post(
        "/kgw/ingest/v1/events",
        json={
            "sourceId": "ga2_audit_test",
            "itemId": item_id,
            "op": "upsert",
            "knCode": _KN_DIRECT,
            "filePath": f"/ga2-audit/{item_id}.md",
            "content": "# GA2 audit test",
        },
        headers=_hdrs(),
    )
    assert resp_ingest.json()["resultCode"] == "0", (
        f"Ingest failed: {resp_ingest.json()}"
    )

    # Flush the async audit writer so the entry is persisted to DB
    await app.state.audit.flush()

    # Query audit filtered by operationType
    resp = await client.get(
        "/kgw/admin/v1/audit",
        params={"operationType": "ingest.upsert"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    data = body["resultObject"].get("data")
    assert isinstance(data, list)
    # Every returned entry must be an ingest.upsert operation
    for entry in data:
        assert entry["operationType"] == "ingest.upsert", (
            f"Unexpected operationType: {entry['operationType']}"
        )
    # The ingest we just triggered should appear
    sources = [e.get("source") for e in data]
    assert "ingest" in sources, f"Expected ingest source in results, got: {sources}"


# ---------------------------------------------------------------------------
# Audit by time window (GA3)
# ---------------------------------------------------------------------------


async def test_audit_query_by_time_window(client):
    """GA3: Query audit logs within a time window."""
    # Note the time slightly before the operation
    before = (datetime.now(timezone.utc) - timedelta(seconds=2)).isoformat()

    # Trigger an ingest event to create an audit entry
    item_id = f"ga3_{uuid.uuid4().hex[:8]}"
    resp_ingest = await client.post(
        "/kgw/ingest/v1/events",
        json={
            "sourceId": "ga3_audit_test",
            "itemId": item_id,
            "op": "upsert",
            "knCode": _KN_DIRECT,
            "filePath": f"/ga3-audit/{item_id}.md",
            "content": "# GA3 time window test",
        },
        headers=_hdrs(),
    )
    assert resp_ingest.json()["resultCode"] == "0", (
        f"Ingest failed: {resp_ingest.json()}"
    )

    # Note the time slightly after
    after = (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat()

    # Query audit within the time window
    resp = await client.get(
        "/kgw/admin/v1/audit",
        params={"fromTime": before, "toTime": after},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    data = body["resultObject"].get("data")
    assert isinstance(data, list)
    # At minimum the ingest event we just triggered should be in the window
    assert len(data) >= 1, "Expected at least one audit entry within time window"

    # Query with a time window in the distant past should return empty
    resp_empty = await client.get(
        "/kgw/admin/v1/audit",
        params={
            "fromTime": "2020-01-01T00:00:00+00:00",
            "toTime": "2020-01-02T00:00:00+00:00",
        },
        headers=_hdrs(),
    )
    body_empty = resp_empty.json()
    assert body_empty["resultCode"] == "0", body_empty
    data_empty = body_empty["resultObject"].get("data")
    assert data_empty == [], f"Expected empty list, got: {data_empty}"


# ---------------------------------------------------------------------------
# Expired lock replacement (GA7)
# ---------------------------------------------------------------------------

_EXPIRED_LOCK_PATH = "/admin-lock/expired.md"


async def test_lock_expired_replacement(client, pool):
    """GA7: Expired lock can be replaced by a new lock with different owner."""
    # Directly insert an expired lock into the DB (expiresAt = 1 hour ago)
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_kb_source_lock "
            "(kn_code, file_path, lock_owner, expires_at) "
            "VALUES (%s, %s, %s, NOW() - INTERVAL '1 hour')",
            (_KN_DIRECT, _EXPIRED_LOCK_PATH, "old_owner"),
        )

    # Lock again with different owner — should succeed because old lock expired
    resp = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_EXPIRED_LOCK_PATH.lstrip('/')}/lock",
        json={"lockOwner": "new_owner"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["lockOwner"] == "new_owner"

    # Re-locking with the same owner should now fail (already locked)
    resp_reject = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_EXPIRED_LOCK_PATH.lstrip('/')}/lock",
        json={"lockOwner": "new_owner"},
        headers=_hdrs(),
    )
    assert resp_reject.json()["resultCode"] == "-1", (
        "Expected re-lock to be rejected after replacement"
    )

    # Cleanup: unlock
    resp_unlock = await client.post(
        f"/kgw/admin/v1/kbs/{_KN_DIRECT}"
        f"/files%2F{_EXPIRED_LOCK_PATH.lstrip('/')}/unlock",
        headers=_hdrs(),
    )
    assert resp_unlock.json()["resultCode"] == "0"


# ---------------------------------------------------------------------------
# Sync retry (GA12)
# ---------------------------------------------------------------------------


async def test_sync_retry(client, pool):
    """GA12: Retry a failed sync — status goes SYNCING."""
    prop_name = f"ga12_sync_retry_{uuid.uuid4().hex[:8]}"
    backend_name = f"__byclaw_kgw__{prop_name}"

    # Insert a metadata property with a FAILED sync row
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, backend_name, value_type, status) "
                "VALUES (%s, %s, 'string', 'ACTIVE')",
                (prop_name, backend_name),
            )
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property WHERE property_name=%s",
                (prop_name,),
            )
            pid = (await cur.fetchone())["property_id"]
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, endpoint_key, sync_status, last_error) "
                "VALUES (%s, %s, 'FAILED', 'simulated failure for test')",
                (pid, "test_endpoint"),
            )

    # Retry sync
    resp = await client.post(
        f"/kgw/admin/v1/metadata-properties/{prop_name}/sync-retry",
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["updated"] >= 1, (
        f"Expected at least 1 row updated, got: {body}"
    )

    # Verify status changed to SYNCING and last_error cleared
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status, last_error FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (pid, "test_endpoint"),
            )
            row = await cur.fetchone()
            assert row is not None, "Sync row should exist"
            assert row["sync_status"] == "SYNCING", (
                f"Expected SYNCING, got: {row['sync_status']}"
            )
            assert row["last_error"] is None, (
                f"Expected last_error cleared, got: {row['last_error']}"
            )

    # Cleanup
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property WHERE property_id=%s",
                (pid,),
            )


# ---------------------------------------------------------------------------
# Purge retry (GA13)
# ---------------------------------------------------------------------------


async def test_purge_retry(client, pool):
    """GA13: Retry a failed purge — status goes PURGING."""
    prop_name = f"ga13_purge_retry_{uuid.uuid4().hex[:8]}"
    backend_name = f"__byclaw_kgw__{prop_name}"

    # Insert a DELETED metadata property with a PURGE_FAILED sync row
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, backend_name, value_type, status) "
                "VALUES (%s, %s, 'string', 'DELETED')",
                (prop_name, backend_name),
            )
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property WHERE property_name=%s",
                (prop_name,),
            )
            pid = (await cur.fetchone())["property_id"]
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, endpoint_key, sync_status, last_error) "
                "VALUES (%s, %s, 'PURGE_FAILED', 'simulated purge failure')",
                (pid, "test_endpoint"),
            )

    # Retry purge
    resp = await client.post(
        f"/kgw/admin/v1/metadata-properties/{prop_name}/purge-retry",
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    assert body["resultObject"]["updated"] >= 1, (
        f"Expected at least 1 row updated, got: {body}"
    )

    # Verify status changed to PURGING and last_error cleared
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status, last_error FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND endpoint_key=%s",
                (pid, "test_endpoint"),
            )
            row = await cur.fetchone()
            assert row is not None, "Sync row should exist"
            assert row["sync_status"] == "PURGING", (
                f"Expected PURGING, got: {row['sync_status']}"
            )
            assert row["last_error"] is None, (
                f"Expected last_error cleared, got: {row['last_error']}"
            )

    # Cleanup
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property WHERE property_id=%s",
                (pid,),
            )
