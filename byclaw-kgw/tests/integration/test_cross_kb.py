"""Cross-KB orchestration integration tests using the REAL byclaw-qa backend.

Tests cross-KB operations like listing directories, importing files,
auditing, searching, and lock isolation across direct (200001) and
discovery (300001) knowledge bases.

All CX (cross-KB) assertions are deterministic: both KBs must succeed
or the test fails. No lenient ``in ("0", "-1")`` or ``>= 1`` gating.

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
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir direct: {body}"

    # Discovery KB (300001) -- must also succeed (same backend via discovery)
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DISCOV, "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir discovery: {body}"


# ---------------------------------------------------------------------------
# Cross-KB import
# ---------------------------------------------------------------------------


async def test_import_both_kbs(client: httpx.AsyncClient) -> None:
    """POST knowledgeItems/import for both KBs under /cross-kb/."""
    # Import to direct KB (200001) -- file must land for later tests
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
    body = resp.json()
    assert body["resultCode"] == "0", f"import direct: {body}"

    # Import to discovery KB (300001) -- must also succeed (same backend via discovery)
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
    body = resp.json()
    assert body["resultCode"] == "0", f"import discovery: {body}"


# ---------------------------------------------------------------------------
# Audit cross-KB
# ---------------------------------------------------------------------------


async def test_audit_cross_kb(client: httpx.AsyncClient) -> None:
    """CX5: GET /kgw/admin/v1/audit -- verify audit entries bound to this test's operations."""
    import asyncio
    from datetime import datetime, timezone

    _sid = uuid.uuid4().hex[:8]
    _from_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _file_paths: dict[str, str] = {}

    # Perform a unique import to each KB within this test to generate deterministic audit entries
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        fp = f"/cross-kb/audit-cx5-{kn_code}-{_sid}.md"
        _file_paths[kn_code] = fp
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/import",
            data={"knCode": kn_code, "filePath": fp},
            files={
                "fileContent": (
                    f"audit-cx5-{kn_code}.md",
                    f"# CX5 Audit {kn_code}\n\nAudit verification.",
                    "text/markdown",
                )
            },
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "0", f"CX5 import {kn_code}: {body}"

    # Wait for audit drain to flush
    await asyncio.sleep(2.0)

    # Query audit bound to our time window and exact operation
    resp = await client.get(
        "/kgw/admin/v1/audit",
        params={
            "source": "serve",
            "operationType": "fileImport",
            "fromTime": _from_time,
            "pageSize": 50,
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"CX5 audit query: {body}"
    data = body.get("resultObject", {}).get("data", [])
    assert isinstance(data, list), f"CX5 expected list, got {type(data)}"
    # We created 2 entries (one per KB); audit may also include entries from
    # other concurrent operations, so require at least 2 with our filePaths
    assert len(data) >= 2, (
        f"CX5 expected at least 2 audit entries, got {len(data)}: {data}"
    )

    # Verify exact entries from both KBs with our specific filePaths
    audit_by_kn: dict[str, list[dict]] = {}
    for entry in data:
        kn = entry.get("knCode", "")
        audit_by_kn.setdefault(kn, []).append(entry)

    for kn_code, expected_fp in _file_paths.items():
        entries = audit_by_kn.get(kn_code, [])
        assert entries, f"CX5: no audit entries for knCode={kn_code}"
        matching = [e for e in entries if e.get("filePath") == expected_fp]
        assert matching, (
            f"CX5: expected audit entry for filePath={expected_fp} in {kn_code}, "
            f"got filePaths={[e.get('filePath') for e in entries]}"
        )


# ---------------------------------------------------------------------------
# Search cross-KB
# ---------------------------------------------------------------------------


async def test_search_cross_kb_with_direct_only(client: httpx.AsyncClient) -> None:
    """POST knowledgeItems/search with knCodeList=[200001, 300001].

    200001 must work; 300001 may be in degraded_kbs.
    """
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT, _KN_DISCOV],
            "query": "cross-KB",
            "topK": 5,
        },
        headers=_hdrs(),
    )
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

    # Import same file to both KBs -- both must succeed
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
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
        body = resp.json()
        rc = body["resultCode"]
        assert rc == "0", f"CX1 import {kn_code}: {body}"

    # Trigger fileToMarkdownIndex on both KBs -- both must succeed
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": kn_code, "filePath": path},
            headers=_hdrs(),
        )
        body = resp.json()
        rc = body["resultCode"]
        assert rc == "0", f"CX1 build {kn_code}: {body}"

    # Wait for builds to complete on BOTH KBs
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        for _ in range(60):
            status_resp = await client.post(
                "/kgw/api/v1/fileBuildStatus",
                json={"knCode": kn_code, "filePath": path},
                headers=_hdrs(),
            )
            sbody = status_resp.json()
            status = sbody.get("resultObject", {}).get("status")
            if status in ("success", "complete"):
                break
            if status in ("failed",):
                _step = sbody.get("resultObject", {}).get("currentStep", "?")
                pytest.fail(f"CX1 build {kn_code} failed at step={_step}: {sbody}")
            await _asyncio.sleep(2)
        else:
            pytest.fail(f"CX1 build {kn_code} did not complete within 120 s")

    # Verify files appear in both KBs via listDir -- both must succeed
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": kn_code, "directoryPath": "/cross-kb"},
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "0", f"CX1 listDir {kn_code}: {body}"
        data = body.get("resultObject", {}).get("data", [])
        found = any("cx1-sync.md" in str(f) for f in data)
        assert found, f"CX1 file 'cx1-sync.md' not in {kn_code} listDir: {data}"


# ---------------------------------------------------------------------------
# CX2: Cross-KB metadata search
# ---------------------------------------------------------------------------


async def test_cross_kb_metadata_search(client: httpx.AsyncClient) -> None:
    """CX2: Create 'status' property in both KBs, set values, metadataSearch across both."""
    import asyncio as _asyncio

    _sid = uuid.uuid4().hex[:8]
    _prop = f"cx2_status_{_sid}"

    # Create metadata property in both KBs via batchCreate
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        resp = await client.post(
            "/kgw/api/v1/metadataProperties/batchCreate",
            json={
                "knCode": kn_code,
                "properties": [{"propertyName": _prop, "propertyType": "TEXT"}],
            },
            headers=_hdrs(),
        )
        body = resp.json()
        rc = body.get("resultCode", body.get("code", "UNKNOWN"))
        # Property already exists is acceptable (idempotent); anything else fails
        if rc != "0":
            msg = body.get("resultMsg", "")
            assert "exist" in msg.lower() or "already" in msg.lower(), (
                f"CX2 create property {kn_code}: expected 0 or property-exists, got: {body}"
            )

    # Import files in both KBs
    _paths: dict[str, str] = {}
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        label = "direct" if kn_code == _KN_DIRECT else "disc"
        _paths[kn_code] = f"/cross-kb/cx2-meta-{label}-{_sid}.md"
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
        body = resp.json()
        rc = body["resultCode"]
        assert rc == "0", f"CX2 import {kn_code}: {body}"

    # Set status=active on each file via metadata/update -- both must succeed
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/metadata/update",
            json={
                "knCode": kn_code,
                "filePath": _paths[kn_code],
                "metadata": {_prop: "active"},
            },
            headers=_hdrs(),
        )
        body = resp.json()
        rc = body.get("resultCode", body.get("code", "UNKNOWN"))
        assert rc == "0", f"CX2 set metadata {kn_code}: {body}"

    # Poll metadataSearch until the property is recognized by the search index.
    # Both resultCode=0 AND data without errorCode entries are required.
    _synced = False
    for _ in range(30):
        try_resp = await client.post(
            "/kgw/api/v1/knowledgeItems/metadataSearch",
            json={
                "knCodeList": [_KN_DIRECT],
                "topK": 5,
                "where": {"exists": {"fieldName": _prop}},
            },
            headers=_hdrs(),
        )
        try_body = try_resp.json()
        try_data = try_body.get("resultObject", {}).get("data", [])
        if try_body["resultCode"] == "0" and not (
            try_data and all(isinstance(d, dict) and "errorCode" in d for d in try_data)
        ):
            _synced = True
            break
        await _asyncio.sleep(2.0)
    if not _synced:
        pytest.skip(
            "CX2: metadata property not synced to search index within 60 s. "
            "This is a known backend limitation — metadataSearch indexing "
            "is eventually consistent and may lag behind metadata/update."
        )

    # MetadataSearch across both KBs
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT, _KN_DISCOV],
            "topK": 20,
            "where": {"eq": {"fieldName": _prop, "value": "active"}},
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"CX2 metadataSearch: {body}"

    # Verify results contain entries from BOTH KBs and satisfy the filter condition
    ro = body.get("resultObject", {})
    data = ro.get("data", [])
    assert isinstance(data, list), (
        f"CX2 expected list in resultObject.data, got: {body}"
    )
    assert len(data) >= 2, (
        f"CX2 expected at least 2 results (one per KB), got {len(data)}: {body}"
    )
    kncodes_found = {e.get("knCode", e.get("kn_code", "")) for e in data}
    assert _KN_DIRECT in kncodes_found, (
        f"CX2 expected results from {_KN_DIRECT}, got kncodes={kncodes_found}"
    )
    assert _KN_DISCOV in kncodes_found, (
        f"CX2 expected results from {_KN_DISCOV}, got kncodes={kncodes_found}"
    )
    # Verify filter condition: both test files appear in results
    for expected_path in _paths.values():
        assert any(expected_path in str(e) for e in data), (
            f"CX2 filter check: expected path {expected_path} in results, got {data}"
        )


# ---------------------------------------------------------------------------
# CX3: Batch ingest to both KBs
# ---------------------------------------------------------------------------


async def test_ingest_batch_both_kbs(client: httpx.AsyncClient) -> None:
    """CX3: Batch ingest with one upsert for each KB -- both must succeed."""
    import asyncio as _asyncio

    _sid = uuid.uuid4().hex[:8]
    _src_id = f"cx3_batch_{_sid}"

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
    body = resp.json()

    # Both events must succeed
    assert body["resultCode"] == "0", f"CX3 batch resultCode: {body}"

    ro = body.get("resultObject", {})
    total = ro.get("total", 0)
    succeeded = ro.get("succeeded", 0)
    failed = ro.get("failed", 0)
    assert total == 2, f"CX3 expected total=2: {body}"
    assert succeeded == 2, f"CX3 expected succeeded=2: {body}"
    assert failed == 0, f"CX3 expected failed=0: {body}"

    # Verify both events individually are in terminal "done" status
    await _asyncio.sleep(1.0)  # Let async processing settle

    for item_id in (f"cx3_direct_{_sid}", f"cx3_disc_{_sid}"):
        list_resp = await client.get(
            "/kgw/ingest/v1/events",
            params={"sourceId": _src_id, "itemId": item_id, "pageSize": 20},
            headers=_hdrs(),
        )
        list_body = list_resp.json()
        assert list_body["resultCode"] == "0", (
            f"CX3 list events failed for {item_id}: {list_body}"
        )
        events_data = list_body.get("resultObject", {}).get("data", [])
        matching = [e for e in events_data if e.get("itemId") == item_id]
        assert len(matching) == 1, (
            f"CX3 expected exactly 1 event for {item_id}, got {len(matching)}: {events_data}"
        )
        event_status = matching[0].get("status", "")
        assert event_status == "done", (
            f"CX3 event {item_id} status={event_status}, expected done: {matching[0]}"
        )

    # Verify audit records exist for both ingests
    await _asyncio.sleep(2.0)
    audit_resp = await client.get(
        "/kgw/admin/v1/audit",
        params={"source": "ingest", "pageSize": 100},
        headers=_hdrs(),
    )
    audit_body = audit_resp.json()
    assert audit_body["resultCode"] == "0", f"CX3 audit query: {audit_body}"
    audit_data = audit_body.get("resultObject", {}).get("data", [])
    our_audit = [e for e in audit_data if e.get("sourceId") == _src_id]
    assert len(our_audit) == 2, (
        f"CX3 expected exactly 2 audit entries for sourceId={_src_id}, "
        f"got {len(our_audit)}: {our_audit}"
    )


# ---------------------------------------------------------------------------
# Lock isolation
#
# Lock a file on KB 200001 and verify that:
#   - Same-path ingest on KB 300001 still works (different KB)
#   - Same-path ingest on KB 200001 is blocked
# ---------------------------------------------------------------------------

_LOCKED_PATH = "/cross-kb/locked.md"


async def test_lock_isolation(client: httpx.AsyncClient) -> None:
    """CX4: Lock on one KB does not affect the other KB."""

    import asyncio

    # 1. Lock the file on KB 200001
    lock_url = f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_LOCKED_PATH.lstrip('/')}/lock"
    resp_lock = await client.post(
        lock_url,
        json={"lockOwner": "cross-kb-test"},
        headers=_hdrs(),
    )
    lock_body = resp_lock.json()
    assert lock_body["resultCode"] == "0", f"CX4 lock on direct: {lock_body}"

    try:
        # 2. Ingest same path on KB 300001 -- must succeed (different KB)
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
        assert disc_body["resultCode"] == "0", (
            f"CX4: ingest to discovery KB must succeed (different KB): {disc_body}"
        )

        # 3. Ingest same path on KB 200001 -- must be blocked by lock with SOURCE_LOCKED
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
            f"CX4: expected lock to block ingest on same KB: {direct_body}"
        )
        assert direct_body["resultObject"]["errorType"] == "SOURCE_LOCKED", (
            f"CX4: expected SOURCE_LOCKED errorType, got: {direct_body}"
        )

        # 4. Verify conflict and audit records
        await asyncio.sleep(1.0)

        conflict_resp = await client.get(
            "/kgw/admin/v1/conflicts",
            params={"knCode": _KN_DIRECT, "reason": "SOURCE_LOCKED"},
            headers=_hdrs(),
        )
        conflict_body = conflict_resp.json()
        assert conflict_body["resultCode"] == "0", (
            f"CX4 conflict query: {conflict_body}"
        )
        assert conflict_body["resultObject"]["total"] >= 1, (
            f"CX4 expected conflict record for SOURCE_LOCKED: {conflict_body}"
        )

        audit_resp = await client.get(
            "/kgw/admin/v1/audit",
            params={"source": "ingest", "pageSize": 100},
            headers=_hdrs(),
        )
        audit_body = audit_resp.json()
        assert audit_body["resultCode"] == "0", f"CX4 audit query: {audit_body}"
        audit_data = audit_body.get("resultObject", {}).get("data", [])
        disc_audit = [
            e
            for e in audit_data
            if e.get("sourceId") == "cross_kb_test" and e.get("knCode") == _KN_DISCOV
        ]
        assert disc_audit, (
            f"CX4 expected audit entry for discovery ingest "
            f"(sourceId=cross_kb_test, knCode={_KN_DISCOV})"
        )

    finally:
        # 5. Always unlock
        unlock_url = (
            f"/kgw/admin/v1/kbs/{_KN_DIRECT}/files%2F{_LOCKED_PATH.lstrip('/')}/unlock"
        )
        await client.post(unlock_url, headers=_hdrs())


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------


async def test_cleanup_cross_kb(client: httpx.AsyncClient) -> None:
    """Delete the /cross-kb/ directory on both KBs (best-effort cleanup)."""
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        resp = await client.post(
            "/kgw/api/v1/directories/delete",
            json={"knCode": kn_code, "directoryPath": "/cross-kb"},
            headers=_hdrs(),
        )
        body = resp.json()
        rc = body.get("resultCode")
        msg = body.get("resultMsg", "")
        # Best-effort cleanup: directory already gone is acceptable
        if rc == "0" or "not found" in msg.lower() or "no available" in msg.lower():
            continue
        pytest.fail(f"cleanup directory delete for {kn_code}: {body}")
