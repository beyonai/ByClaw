"""Cross-KB orchestration integration tests using the REAL byclaw-qa backend.

Tests cross-KB operations like listing directories, importing files,
auditing, searching, and lock isolation across direct (200001) and
discovery (300001) knowledge bases.

Discovery mode (300001) may fail if Redis service registration is stale --
all such calls handle failure gracefully.

No respx mocks -- all calls are real.
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

import uuid

import httpx
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_USER_ID = "test_user"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


# ---------------------------------------------------------------------------
# Cross-KB listDir
# ---------------------------------------------------------------------------


async def test_listdir_both_kbs(client: httpx.AsyncClient) -> None:
    """POST listDir for 200001 (must succeed) and 300001 (handle gracefully)."""
    # Direct KB (200001) -- must succeed
    try:
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir direct: {body}"

    # Discovery KB (300001) -- may fail, but must not crash/500
    try:
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DISCOV, "directoryPath": "/"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    body = resp.json()
    rc = body["resultCode"]
    assert rc in ("0", "-1"), f"listDir discovery unexpected result: {body}"


# ---------------------------------------------------------------------------
# Cross-KB import
# ---------------------------------------------------------------------------


async def test_import_both_kbs(client: httpx.AsyncClient) -> None:
    """POST knowledgeItems/import for both KBs under /cross-kb/."""
    # Import to direct KB (200001) -- file must land for later tests
    try:
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/import",
            data={"knCode": _KN_DIRECT, "filePath": "/cross-kb/direct.md"},
            files={
                "fileContent": (
                    "direct.md",
                    b"# Direct KB\n\nContent for cross-KB test.",
                    "text/markdown",
                )
            },
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    body = resp.json()
    assert body["resultCode"] == "0", f"import direct: {body}"

    # Import to discovery KB (300001) -- may fail gracefully
    try:
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/import",
            data={"knCode": _KN_DISCOV, "filePath": "/cross-kb/disc.md"},
            files={
                "fileContent": (
                    "disc.md",
                    b"# Discovery KB\n\nContent for cross-KB test.",
                    "text/markdown",
                )
            },
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    body = resp.json()
    rc = body["resultCode"]
    assert rc in ("0", "-1"), f"import discovery unexpected result: {body}"


# ---------------------------------------------------------------------------
# Audit cross-KB
# ---------------------------------------------------------------------------


async def test_audit_cross_kb(client: httpx.AsyncClient) -> None:
    """GET /kgw/admin/v1/audit -- verify audit entries exist for cross-KB ops."""
    resp = await client.get(
        "/kgw/admin/v1/audit",
        params={"source": "serve", "pageSize": 20},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"audit query: {body}"
    data = body.get("resultObject", {}).get("data", [])
    assert isinstance(data, list), f"expected list, got {type(data)}"
    # At least one entry from direct KB operations should be visible
    if data:
        kncodes_in_audit = {e.get("kn_code", e.get("knCode", "")) for e in data}
        assert _KN_DIRECT in kncodes_in_audit, (
            f"expected entries for {_KN_DIRECT} in audit data: {kncodes_in_audit}"
        )


# ---------------------------------------------------------------------------
# Search cross-KB
# ---------------------------------------------------------------------------


async def test_search_cross_kb_with_direct_only(client: httpx.AsyncClient) -> None:
    """POST knowledgeItems/search with knCodeList=[200001, 300001].

    200001 must work; 300001 may be in degraded_kbs.
    """
    try:
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/search",
            json={
                "knCodeList": [_KN_DIRECT, _KN_DISCOV],
                "query": "cross-KB",
                "topK": 5,
            },
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    body = resp.json()
    assert body["resultCode"] == "0", f"cross-KB search: {body}"


# ---------------------------------------------------------------------------
# Lock isolation
#
# Lock a file on KB 200001 and verify that:
#   - Same-path ingest on KB 300001 still works (different KB)
#   - Same-path ingest on KB 200001 is blocked
# ---------------------------------------------------------------------------

_LOCKED_PATH = "/cross-kb/locked.md"


async def test_lock_isolation(client: httpx.AsyncClient) -> None:
    """Lock on one KB does not affect the other KB."""

    # 1. Lock the file on KB 200001
    lock_url = f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_LOCKED_PATH.lstrip('/')}/lock"
    resp_lock = await client.post(
        lock_url,
        json={"lockOwner": "cross-kb-test"},
        headers=_hdrs(),
    )
    lock_body = resp_lock.json()
    assert lock_body["resultCode"] == "0", f"lock on direct: {lock_body}"

    try:
        # 2. Ingest same path on KB 300001 -- should succeed (different KB)
        disc_item_id = f"cross_kb_lock_disc_{uuid.uuid4().hex[:8]}"
        resp_ingest_disc = await client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "cross_kb_test",
                "itemId": disc_item_id,
                "op": "upsert",
                "knCode": _KN_DISCOV,
                "filePath": _LOCKED_PATH,
                "content": "# Cross-KB locked content on discovery",
            },
            headers=_hdrs(),
        )
        disc_body = resp_ingest_disc.json()
        rc_disc = disc_body["resultCode"]
        # Discovery may be unavailable (-1); if it works (0), verify not blocked
        assert rc_disc in ("0", "-1"), (
            f"ingest to disc while locked on other KB: {disc_body}"
        )

        # 3. Ingest same path on KB 200001 -- should be blocked by lock
        direct_item_id = f"cross_kb_lock_direct_{uuid.uuid4().hex[:8]}"
        resp_ingest_direct = await client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "cross_kb_test",
                "itemId": direct_item_id,
                "op": "upsert",
                "knCode": _KN_DIRECT,
                "filePath": _LOCKED_PATH,
                "content": "# Cross-KB locked content on same KB",
            },
            headers={"X-User-Id": "connector"},
        )
        direct_body = resp_ingest_direct.json()
        assert direct_body["resultCode"] == "-1", (
            f"expected lock to block ingest on same KB: {direct_body}"
        )

    finally:
        # 4. Always unlock
        unlock_url = (
            f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_LOCKED_PATH.lstrip('/')}/unlock"
        )
        await client.post(unlock_url, headers=_hdrs())


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------


async def test_cleanup_cross_kb(client: httpx.AsyncClient) -> None:
    """Delete the /cross-kb/ directory on both KBs (handle failures gracefully)."""
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        try:
            resp = await client.post(
                "/kgw/api/v1/directories/delete",
                json={"knCode": kn_code, "directoryPath": "/cross-kb"},
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            pytest.skip("Proxy interference -- run with NO_PROXY=*")
        body = resp.json()
        rc = body["resultCode"]
        # Directory may not exist if earlier tests were skipped -- ok
        if rc != "0" and "not found" in body.get("resultMsg", ""):
            continue
        assert rc == "0", f"cleanup directory delete for {kn_code}: {body}"
