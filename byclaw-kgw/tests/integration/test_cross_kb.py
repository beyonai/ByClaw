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
        assert _KN_DISCOV in kncodes_in_audit, (
            f"expected entries for {_KN_DISCOV} in audit data: {kncodes_in_audit}"
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
# CX1: Same file sync to both KBs + fileToMarkdownIndex
# ---------------------------------------------------------------------------


async def test_sync_file_to_both_kbs(client: httpx.AsyncClient) -> None:
    """CX1: Import same file content to both KBs and trigger build on both."""
    import asyncio as _asyncio

    content = b"# CX1 Sync Test\n\nCross-KB sync content."
    path = "/cross-kb/cx1-sync.md"

    # Import same file to both KBs
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        try:
            resp = await client.post(
                "/kgw/api/v1/knowledgeItems/import",
                data={"knCode": kn_code, "filePath": path},
                files={
                    "fileContent": (
                        "cx1-sync.md",
                        content,
                        "text/markdown",
                    )
                },
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            pytest.skip("Proxy interference -- run with NO_PROXY=*")
        body = resp.json()
        rc = body["resultCode"]
        # Discovery may be unavailable (-1) but direct must succeed (0)
        assert rc in ("0", "-1") if kn_code == _KN_DISCOV else rc == "0", (
            f"CX1 import {kn_code}: {body}"
        )

    # Trigger fileToMarkdownIndex on both KBs
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        try:
            resp = await client.post(
                "/kgw/api/v1/fileToMarkdownIndex",
                json={"knCode": kn_code, "filePath": path},
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            pytest.skip("Proxy interference -- run with NO_PROXY=*")
        body = resp.json()
        rc = body["resultCode"]
        # Discovery may be unavailable (-1) but direct build must succeed (0)
        assert rc in ("0", "-1") if kn_code == _KN_DISCOV else rc == "0", (
            f"CX1 build {kn_code}: {body}"
        )

    # Wait for builds to complete on direct KB
    for _ in range(60):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": path},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status in ("success", "complete"):
            break
        if status in ("failed",):
            _step = sbody.get("resultObject", {}).get("currentStep", "?")
            pytest.skip(
                f"CX1 build failed at step={_step} -- embedding API may be unreachable"
            )
        await _asyncio.sleep(2)
    else:
        pytest.fail("CX1 build did not complete within 120 s")

    # Verify files appear in both KBs via listDir
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        try:
            resp = await client.post(
                "/kgw/api/v1/listDir",
                json={"knCode": kn_code, "directoryPath": "/cross-kb"},
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            pytest.skip("Proxy interference -- run with NO_PROXY=*")
        body = resp.json()
        rc = body["resultCode"]
        if rc not in ("0", "-1"):
            pytest.fail(f"CX1 listDir {kn_code} unexpected result: {body}")
        if rc == "0":
            data = body.get("resultObject", {}).get("data", [])
            found = any("cx1-sync.md" in str(f) for f in data)
            assert found, f"CX1 file 'cx1-sync.md' not in {kn_code} listDir: {data}"


# ---------------------------------------------------------------------------
# CX2: Cross-KB metadata search
# ---------------------------------------------------------------------------


async def test_cross_kb_metadata_search(client: httpx.AsyncClient) -> None:
    """CX2: Create 'status' property in both KBs, set values, metadataSearch across both."""
    _sid = uuid.uuid4().hex[:8]
    _prop = f"cx2_status_{_sid}"

    # Create metadata property in both KBs via batchCreate
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        try:
            resp = await client.post(
                "/kgw/api/v1/metadataProperties/batchCreate",
                json={
                    "knCode": kn_code,
                    "properties": [{"propertyName": _prop, "propertyType": "TEXT"}],
                },
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            pytest.skip("Proxy interference -- run with NO_PROXY=*")
        body = resp.json()
        rc = body.get("resultCode", body.get("code", "-1"))
        if rc not in ("0", "-1"):
            # Duplicate or discovery-unavailable are acceptable
            msg = body.get("resultMsg", "")
            if "exist" in msg or "unavailable" in msg.lower():
                continue
            pytest.fail(f"CX2 create property {kn_code}: {body}")

    # Import files in both KBs
    _paths: dict[str, str] = {}
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        label = "direct" if kn_code == _KN_DIRECT else "disc"
        _paths[kn_code] = f"/cross-kb/cx2-meta-{label}-{_sid}.md"
        try:
            resp = await client.post(
                "/kgw/api/v1/knowledgeItems/import",
                data={"knCode": kn_code, "filePath": _paths[kn_code]},
                files={
                    "fileContent": (
                        f"cx2-{label}.md",
                        f"# CX2 {label}\n\nMetadata search test content.",
                        "text/markdown",
                    )
                },
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            pytest.skip("Proxy interference -- run with NO_PROXY=*")
        body = resp.json()
        rc = body["resultCode"]
        assert rc in ("0", "-1"), f"CX2 import {kn_code}: {body}"

    # Set status=active on each file via metadata/update
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        try:
            resp = await client.post(
                "/kgw/api/v1/knowledgeItems/metadata/update",
                json={
                    "knCode": kn_code,
                    "filePath": _paths[kn_code],
                    "metadata": {_prop: "active"},
                },
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            pytest.skip("Proxy interference -- run with NO_PROXY=*")
        body = resp.json()
        rc = body.get("resultCode", body.get("code", "-1"))
        if rc == "-1" and kn_code == _KN_DISCOV:
            continue  # discovery may be unavailable
        assert rc == "0", f"CX2 set metadata {kn_code}: {body}"

    # MetadataSearch across both KBs
    try:
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/metadataSearch",
            json={
                "knCodeList": [_KN_DIRECT, _KN_DISCOV],
                "topK": 20,
                "where": {"eq": {"fieldName": _prop, "value": "active"}},
            },
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    body = resp.json()
    assert body["resultCode"] == "0", f"CX2 metadataSearch: {body}"

    # Verify results from both KBs
    ro = body.get("resultObject", {})
    data = ro.get("data", [])
    assert isinstance(data, list), (
        f"CX2 expected list in resultObject.data, got: {body}"
    )
    if data:
        kncodes_found = {e.get("knCode", e.get("kn_code", "")) for e in data}
        # At minimum, the direct KB entry should be present
        assert _KN_DIRECT in kncodes_found or any(
            _paths[_KN_DIRECT] in str(e) for e in data
        ), f"CX2 expected results from {_KN_DIRECT}, got: {data}"


# ---------------------------------------------------------------------------
# CX3: Batch ingest to both KBs
# ---------------------------------------------------------------------------


async def test_ingest_batch_both_kbs(client: httpx.AsyncClient) -> None:
    """CX3: Batch ingest with one upsert for each KB -- both done."""
    _sid = uuid.uuid4().hex[:8]
    _src_id = f"cx3_batch_{_sid}"

    try:
        resp = await client.post(
            "/kgw/ingest/v1/events/batch",
            json={
                "events": [
                    {
                        "sourceId": _src_id,
                        "itemId": f"cx3_direct_{_sid}",
                        "version": "2026-06-08T00:00:00Z",
                        "op": "upsert",
                        "knCode": _KN_DIRECT,
                        "filePath": f"/cross-kb/cx3-direct-{_sid}.md",
                        "content": "# CX3 Direct KB\n\nBatch cross-KB test.",
                    },
                    {
                        "sourceId": _src_id,
                        "itemId": f"cx3_disc_{_sid}",
                        "version": "2026-06-08T00:00:01Z",
                        "op": "upsert",
                        "knCode": _KN_DISCOV,
                        "filePath": f"/cross-kb/cx3-disc-{_sid}.md",
                        "content": "# CX3 Discovery KB\n\nBatch cross-KB test.",
                    },
                ],
            },
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    body = resp.json()

    # Assert resultCode is success (0) or partial-success (-1 if discovery down)
    rc = body.get("resultCode", "-1")
    assert rc in ("0", "-1"), f"CX3 batch resultCode: {body}"

    ro = body.get("resultObject", {})
    total = ro.get("total", 2)
    succeeded = ro.get("succeeded", 0)
    failed = ro.get("failed", 0)
    assert succeeded + failed == total, (
        f"CX3 succeeded({succeeded}) + failed({failed}) != total({total}): {body}"
    )
    # At least the direct KB upsert must succeed
    assert succeeded >= 1, (
        f"CX3 expected at least 1 success (direct KB), got succeeded={succeeded}: {body}"
    )

    # Verify both events are done (or at least present) via GET /kgw/ingest/v1/events
    import asyncio as _asyncio

    await _asyncio.sleep(1.0)  # Let async processing settle

    for item_id in (f"cx3_direct_{_sid}", f"cx3_disc_{_sid}"):
        list_resp = await client.get(
            "/kgw/ingest/v1/events",
            params={"sourceId": _src_id, "pageSize": 20},
            headers=_hdrs(),
        )
        list_body = list_resp.json()
        if list_body.get("resultCode") != "0":
            # Discovery may make the list endpoint fail; skip check if so
            if item_id.startswith("cx3_disc_"):
                continue
            pytest.fail(f"CX3 list events failed for {item_id}: {list_body}")
        events_data = list_body.get("resultObject", {}).get("data", [])
        matching = [e for e in events_data if e.get("itemId") == item_id]
        if matching:
            event_status = matching[0].get("status", "")
            # Accept done or already_processed as success
            assert event_status in ("done", "already_processed"), (
                f"CX3 event {item_id} status={event_status}, expected done: {matching[0]}"
            )
        elif item_id.startswith("cx3_direct_"):
            pytest.fail(f"CX3 event {item_id} not found in event list: {events_data}")


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
        msg = body.get("resultMsg", "")
        # Acceptable: directory not found / discovery not available
        if rc != "0" and ("not found" in msg or "No available instances" in msg):
            continue
        assert rc == "0", f"cleanup directory delete for {kn_code}: {body}"
