"""Integration tests: admin endpoints.

Covers: audit query, conflict query, file lock/unlock,
ingest blocked by lock, metadata-properties list, orphans query.

No respx mocking -- all tests use the real byclaw-qa backend on port 8000
(via ``app.state`` resources seeded by conftest).
"""

# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from __future__ import annotations

import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_KN_DIRECT = "200001"
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
    """GET /kgw/admin/v1/audit?source=serve&pageSize=5 => resultCode=0."""
    resp = await client.get(
        "/kgw/admin/v1/audit",
        params={"source": "serve", "pageSize": 5},
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
    """GET /kgw/admin/v1/metadata-properties => resultCode=0."""
    resp = await client.get(
        "/kgw/admin/v1/metadata-properties",
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body


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
